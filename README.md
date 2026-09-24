# CONINAGRO · Créditos al agro

Dashboard estático (sin backend) con la evolución trimestral de los saldos y
tasas de crédito del sistema financiero a las actividades agroindustriales y
agropecuarias, discriminado por actividad, moneda y provincia. Pensado para
desplegarse en Netlify a partir de este repo.

**Vivo en:** se completa acá el link de Netlify una vez conectado.

## Estructura

```
index.html              página del dashboard
styles.css               estilos (tema claro/oscuro automático)
app.js                    lógica: filtros, gráficos (Chart.js) y tablas
data/dashboard_data.json  datos que consume app.js (se regenera, no se edita a mano)
data/source/              Excel(es) originales, tal cual los entrega la fuente
scripts/build_data.py     convierte el Excel fuente al JSON de arriba
netlify.toml              configuración de build/deploy de Netlify
```

## Cómo están armados los datos

La fuente es un Excel con dos hojas, `SALDOS` y `TASAS`, con esta estructura
por fila: `ACTIVIDAD`, `PERIODO` (AAAAMMDD, cierre de trimestre), `MONEDA`,
un total nacional y luego el desglose por las 24 jurisdicciones (CABA + 23
provincias).

La columna `MONEDA` de `SALDOS` usa esta convención:

| moneda | significa |
|---|---|
| `0` | Total (pesos + dólares, expresado en pesos) |
| `1` | Pesos |
| `2` | Dólares, expresado en su equivalente en pesos |

En cada fila, `moneda 1 + moneda 2 = moneda 0`. Para pasar cualquiera de
estas filas a dólares reales se divide su `TOTAL` por el `TIPO DE CAMBIO`
de esa misma fila (columna D). El dashboard hace esta cuenta para las tres
vistas de moneda del selector: **Pesos**, **Dólares** y **Total
(equivalente en US$)** — esta última es el total pesos+dólares llevado a
dólares al tipo de cambio de cada trimestre, útil para comparar entre
trimestres sin el ruido de la devaluación.

`TASAS` tiene la misma lógica pero sin moneda `0` (no existe un "total" de
tasa): solo `1` (pesos) y `2` (dólares).

### Actividades con serie incompleta

Al cierre de 2025, 8 de las 12 actividades tienen los 4 trimestres completos
y discriminados por moneda. Las otras 4 (granja y otros animales,
procesamiento de carnes y alimentos, elaboración de lácteos, molinería y
alimento balanceado) solo tienen dato del primer trimestre (Mar-25) y sin
discriminar por moneda. El dashboard lo detecta automáticamente
(`completa: false` en el JSON) y lo avisa en la interfaz en vez de simular
datos que no existen. Si en un trimestre futuro esas actividades se
completan, `scripts/build_data.py` las toma solas sin tocar código.

## Actualizar con un trimestre nuevo

1. Reemplazá (o agregá) el Excel en `data/source/`.
2. Corré:
   ```bash
   pip install openpyxl
   python3 scripts/build_data.py "data/source/<archivo>.xlsx" data/dashboard_data.json
   ```
3. Commiteá y subí los cambios — Netlify redespliega solo al detectar el push.

No hace falta tocar `index.html`, `styles.css` ni `app.js` para un
trimestre nuevo: sólo cambia `data/dashboard_data.json`.

## Desarrollo local

Es un sitio 100% estático. Alcanza con:

```bash
python3 -m http.server 8000
```

y abrir `http://localhost:8000`.
