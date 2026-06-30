import json
import sys
from collections import defaultdict

def carregar_eventos(caminho):
    eventos = []
    with open(caminho, 'r') as f:
        for linha in f:
            linha = linha.strip()
            if not linha:
                continue
            try:
                obj = json.loads(linha)
            except json.JSONDecodeError:
                continue

            if obj.get('metric') == 'http_req_duration' and obj.get('type') == 'Point':
                data = obj.get('data', {})
                timestamp_str = data.get('time')
                valor = data.get('value')
                tags = data.get('tags', {})
                status = tags.get('status', 'desconhecido')

                if timestamp_str and valor is not None:
                    eventos.append({
                        'timestamp_ms': iso_para_epoch_ms(timestamp_str),
                        'duracao_ms': valor,
                        'status': status,
                    })
    return eventos


def iso_para_epoch_ms(timestamp_iso):
    """Converte timestamp ISO 8601 do k6 para epoch em milissegundos.
    Aceita formatos como '2026-06-30T00:13:28.944573-03:00' (com timezone)
    ou terminando em 'Z' (UTC)."""
    from datetime import datetime
    ts = timestamp_iso.replace('Z', '+00:00')
    dt = datetime.fromisoformat(ts)
    return int(dt.timestamp() * 1000)


def agrupar_por_segundo(eventos):
    """Agrupa requisicoes em janelas de 1 segundo, calculando taxa de sucesso
    e latencia media/p95 de cada janela."""
    janelas = defaultdict(lambda: {'total': 0, 'sucesso': 0, 'duracoes': []})

    for ev in eventos:
        segundo = ev['timestamp_ms'] // 1000  # trunca para o segundo
        janelas[segundo]['total'] += 1
        if ev['status'] in ('200',):
            janelas[segundo]['sucesso'] += 1
        janelas[segundo]['duracoes'].append(ev['duracao_ms'])

    resultado = {}
    for segundo, dados in janelas.items():
        taxa = dados['sucesso'] / dados['total'] if dados['total'] > 0 else 0
        duracoes_ordenadas = sorted(dados['duracoes'])
        media = sum(duracoes_ordenadas) / len(duracoes_ordenadas)
        resultado[segundo] = {
            'total': dados['total'],
            'sucesso': dados['sucesso'],
            'taxa_sucesso': taxa,
            'latencia_media_ms': media,
        }
    return resultado


def calcular_mttr_latencia(janelas, t_injecao_ms, t_remocao_ms, threshold_latencia_ms=1000):
    """
    Calcula o MTTR baseado em LATENCIA (nao em taxa de erro):
    - Procura o primeiro segundo, a partir da injecao, onde a latencia media
      subiu acima do threshold (sistema degradado, mesmo respondendo 200)
    - Procura o primeiro segundo, depois disso, onde a latencia volta a ficar
      abaixo do threshold de forma sustentada
    """
    seg_injecao = t_injecao_ms // 1000
    segundos_ordenados = sorted(janelas.keys())

    momento_degradacao = None
    for seg in segundos_ordenados:
        if seg >= seg_injecao and janelas[seg]['latencia_media_ms'] > threshold_latencia_ms:
            momento_degradacao = seg
            break

    if momento_degradacao is None:
        return {
            'degradacao_detectada': False,
            'mensagem': f'Latencia nunca passou de {threshold_latencia_ms}ms apos a injecao.',
        }

    momento_recuperacao = None
    for seg in segundos_ordenados:
        if seg > momento_degradacao and janelas[seg]['latencia_media_ms'] <= threshold_latencia_ms:
            proximos = [janelas[s]['latencia_media_ms'] for s in segundos_ordenados if seg < s <= seg + 3]
            if all(lat <= threshold_latencia_ms for lat in proximos) or not proximos:
                momento_recuperacao = seg
                break

    if momento_recuperacao is None:
        return {
            'degradacao_detectada': True,
            'momento_degradacao': momento_degradacao,
            'recuperacao_detectada': False,
            'mensagem': 'Degradacao de latencia detectada mas sem recuperacao dentro da janela do teste.',
        }

    mttr_segundos = momento_recuperacao - momento_degradacao
    return {
        'degradacao_detectada': True,
        'recuperacao_detectada': True,
        'momento_degradacao_epoch': momento_degradacao,
        'momento_recuperacao_epoch': momento_recuperacao,
        'mttr_segundos': mttr_segundos,
    }


def calcular_mttr(janelas, t_injecao_ms, t_remocao_ms, threshold_recuperacao=0.80):
    """
    Calcula o MTTR real:
    - Procura o primeiro segundo, a partir da injecao, onde a taxa de sucesso caiu
    - Procura o primeiro segundo, depois disso, onde a taxa de sucesso volta a >= threshold
    """
    seg_injecao = t_injecao_ms // 1000
    seg_remocao = t_remocao_ms // 1000

    segundos_ordenados = sorted(janelas.keys())

    momento_degradacao = None
    for seg in segundos_ordenados:
        if seg >= seg_injecao and janelas[seg]['taxa_sucesso'] < threshold_recuperacao:
            momento_degradacao = seg
            break

    if momento_degradacao is None:
        return {
            'degradacao_detectada': False,
            'mensagem': 'Nenhuma degradacao abaixo do threshold foi detectada — sistema manteve SLO durante o caos.',
        }

    momento_recuperacao = None
    for seg in segundos_ordenados:
        if seg > momento_degradacao and janelas[seg]['taxa_sucesso'] >= threshold_recuperacao:
            proximos = [janelas[s]['taxa_sucesso'] for s in segundos_ordenados if seg < s <= seg + 3]
            if all(t >= threshold_recuperacao for t in proximos) or not proximos:
                momento_recuperacao = seg
                break

    if momento_recuperacao is None:
        return {
            'degradacao_detectada': True,
            'momento_degradacao': momento_degradacao,
            'recuperacao_detectada': False,
            'mensagem': 'Degradacao detectada mas o sistema nao se recuperou dentro da janela do teste.',
        }

    mttr_segundos = momento_recuperacao - momento_degradacao

    return {
        'degradacao_detectada': True,
        'recuperacao_detectada': True,
        'momento_degradacao_epoch': momento_degradacao,
        'momento_recuperacao_epoch': momento_recuperacao,
        'mttr_segundos': mttr_segundos,
    }


def main():
    if len(sys.argv) < 2:
        print("Uso: python3 calcular-mttr.py <caminho-raw-events.json>")
        sys.exit(1)

    caminho = sys.argv[1]
    print(f"Lendo eventos de {caminho}...")
    eventos = carregar_eventos(caminho)
    print(f"Total de requisicoes HTTP encontradas: {len(eventos)}")

    if not eventos:
        print("Nenhum evento de http_req_duration encontrado. Verifique o arquivo.")
        sys.exit(1)

    janelas = agrupar_por_segundo(eventos)

    primeiro_seg = min(janelas.keys())
    ultimo_seg = max(janelas.keys())
    print(f"Janela de tempo dos dados: {primeiro_seg} até {ultimo_seg} ({ultimo_seg - primeiro_seg}s de duracao)")
    print("")

    experimentos = {
        "Experimento 1 - Gateway Lento": {
            "injecao_ms": 1782789212000,  # 00:13:32
            "remocao_ms": 1782789272000,  # 00:14:33
        },
        "Experimento 2 - Thundering Herd": {
            "injecao_ms": 1782789303000,  # 00:15:03
            "remocao_ms": 1782789363000,  # 00:16:03
        },
    }

    for nome, ts in experimentos.items():
        print(f"=== {nome} ===")

        print("  -- MTTR por taxa de sucesso (threshold 80%) --")
        resultado = calcular_mttr(janelas, ts['injecao_ms'], ts['remocao_ms'])
        if resultado.get('degradacao_detectada'):
            if resultado.get('recuperacao_detectada'):
                print(f"  MTTR (disponibilidade): {resultado['mttr_segundos']} segundos")
            else:
                print(f"  {resultado['mensagem']}")
        else:
            print(f"  {resultado['mensagem']}")

        print("  -- MTTR por latencia (threshold 1000ms) --")
        resultado_lat = calcular_mttr_latencia(janelas, ts['injecao_ms'], ts['remocao_ms'])
        if resultado_lat.get('degradacao_detectada'):
            if resultado_lat.get('recuperacao_detectada'):
                print(f"  MTTR (latencia): {resultado_lat['mttr_segundos']} segundos")
                print(f"    Degradou em epoch: {resultado_lat['momento_degradacao_epoch']}")
                print(f"    Recuperou em epoch: {resultado_lat['momento_recuperacao_epoch']}")
            else:
                print(f"  {resultado_lat['mensagem']}")
        else:
            print(f"  {resultado_lat['mensagem']}")
        print("")

    print("=== Detalhe segundo a segundo (Experimento 1 - latencia) ===")
    seg_ini = experimentos["Experimento 1 - Gateway Lento"]["injecao_ms"] // 1000
    seg_fim = experimentos["Experimento 1 - Gateway Lento"]["remocao_ms"] // 1000 + 30
    for seg in sorted(janelas.keys()):
        if seg_ini - 5 <= seg <= seg_fim:
            d = janelas[seg]
            print(f"  seg={seg}  total={d['total']:4d}  latencia_media={d['latencia_media_ms']:.0f}ms  taxa_sucesso={d['taxa_sucesso']*100:.1f}%")

    print("")
    print("=== Detalhe segundo a segundo (Experimento 2 - latencia) ===")
    seg_ini2 = experimentos["Experimento 2 - Thundering Herd"]["injecao_ms"] // 1000
    seg_fim2 = experimentos["Experimento 2 - Thundering Herd"]["remocao_ms"] // 1000 + 30
    for seg in sorted(janelas.keys()):
        if seg_ini2 - 5 <= seg <= seg_fim2:
            d = janelas[seg]
            print(f"  seg={seg}  total={d['total']:4d}  latencia_media={d['latencia_media_ms']:.0f}ms  taxa_sucesso={d['taxa_sucesso']*100:.1f}%")


if __name__ == '__main__':
    main()