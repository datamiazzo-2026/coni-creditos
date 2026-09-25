# CONINAGRO · Créditos al agro

Dashboard estático (sin backend) con la evolución trimestral de los saldos y
tasas de crédito del sistema financiero a las actividades agroindustriales y
agropecuarias, discriminado por actividad, moneda y provincia. Pensado para
desplegarse en Netlify a partir de este repo.

**Vivo en:** se completa acá el link de Netlify una vez conectado.

## Estructura

```
index.html              página del dashboard
styles.css               estilos (tema claro, igual al de monitordegranos.com.ar)
app.js                    lógica: filtros, gráficos (Chart.js) y tablas
data/dashboard_data.json  datos que consume app.js (se regenera, no se edita a mano)
data/source/              Excel(es) originales, tal cual los entrega la fuente
scripts/build_data.py     convierte el/los Excel fuente al JSON de arriba
netlify.toml              configuración de build/deploy de Netlify
```

## Cómo están armados los datos

`scripts/build_data.py` puede leer DOS formatos de Excel fuente, y podés
pasarle varios archivos juntos (por ejemplo uno por año) para que el
dashboard muestre la serie completa combinada:

1. **Formato "crudo BCRA"** (`.xls`, hojas `Saldos` / `Tasas` /
   `Observaciones`): es el reporte SISCEN completo tal cual lo exporta el
   BCRA, con **todas** las actividades económicas del país (no solo agro),
   en una jerarquía CIIU/CLANAE. El script identifica solo a las 12
   actividades agro **por coincidencia exacta de nombre**, así que se le
   puede pasar el archivo bruto, sin filtrar antes a mano. Es el formato
   que se usa actualmente para **todos** los años cargados, 2015 a 2025
   (`data/source/PRESTAMOS_AL_SECTOR_AGRO_<año>_bcra_crudo.xls`).
2. **Formato "limpio"** (`.xlsx`, hojas `... - SALDOS` / `... - TASAS`):
   pensado para un Excel ya filtrado a mano a las 12 actividades agro. El
   script lo sigue soportando, pero **no se usa ningún archivo en este
   formato en el dataset actual** — el que se usaba para 2025 se reemplazó
   por el crudo BCRA equivalente (ver más abajo, "Reemplazo del Excel
   'limpio' de 2025").

En ambos formatos, cada fila es `ACTIVIDAD` × `PERIODO` (AAAAMMDD, cierre de
trimestre) × `MONEDA`, con un total nacional y el desglose por las 24
jurisdicciones (CABA + 23 provincias). La columna `MONEDA` usa esta
convención:

| moneda | significa |
|---|---|
| `0` | Total (pesos + dólares, expresado en pesos) — no existe en TASAS |
| `1` | Pesos |
| `2` | Dólares, expresado en su equivalente en pesos |

En cada fila de `SALDOS`, `moneda 1 + moneda 2 = moneda 0`. Para pasar
cualquiera de estas filas a dólares reales se divide su `TOTAL` por el
`TIPO DE CAMBIO` de esa misma fila. El dashboard hace esta cuenta para las
tres vistas de moneda del selector: **Pesos**, **Dólares** y **Total
(equivalente en US$)** — esta última es el total pesos+dólares llevado a
dólares al tipo de cambio de cada trimestre, útil para comparar entre
trimestres sin el ruido de la devaluación.

`TASAS` tiene la misma lógica pero sin moneda `0`. El valor de `TASAS` es
la tasa nacional tal cual la reporta la fuente (columna `TOTAL`) — el
dashboard no calcula ningún promedio ni ponderación propia, solo la
muestra.

### Ojo con las columnas al actualizar el Excel

**Formato limpio:** `SALDOS` tiene una columna `TIPO DE CAMBIO` entre
`MONEDA` y `TOTAL` que `TASAS` no tiene, así que el desglose por provincia
arranca en una columna distinta en cada hoja (`F` en `SALDOS`, `E` en
`TASAS`). `read_clean_sheet()` en `scripts/build_data.py` ya contempla ese
corrimiento (`total_col`/`prov_start_col`); si la fuente cambia de
estructura hay que revisar esos dos parámetros.

**Formato crudo BCRA:** es bastante más engañoso. La columna que sigue a
CABA no es la provincia de Buenos Aires en sí, sino su **total** (Gran
Buenos Aires + Resto sumados); las dos columnas siguientes son ese mismo
desglose interno de Buenos Aires, que hay que **saltear** para no contar
la provincia dos veces. El resto de las provincias sí es un bloque
contiguo en el mismo orden que `PROVINCIAS`. `read_raw_bcra_workbook()`
tiene los índices de columna ya resueltos (`saldos_prov_cols` /
`tasas_prov_cols`), pero como el BCRA podría reordenar columnas en un
export futuro, `read_raw_bcra_sheet()` valida cada columna contra el
texto de su encabezado y, para `SALDOS`, además contra que
CABA + provincias sumen el total de la fila — si alguna de las dos
validaciones falla, el script corta con un error en vez de guardar datos
corridos de provincia (así se detectó, en la versión limpia de 2025, un
bug real donde el desglose de `TASAS` por provincia venía corrido una
columna).

Otra cosa a tener en cuenta: el BCRA no siempre le pone el mismo nombre a
CABA en el encabezado — en el export de 2024 dice "CABA" y en el de 2023
dice "Capital Federal" (son la misma jurisdicción, `_validate_prov_columns`
ya contempla ambos nombres como alias). Si en un export futuro aparece
otra variante y la validación corta con error, agregar el alias nuevo a la
lista `aliases` de esa función alcanza para resolverlo.

Otra cosa rara, esta vez que NO afecta los datos: el título en inglés de la
hoja `Saldos` del export de 2017 dice "TOTAL LOANS - **PUBLIC BANKS**",
mientras que todos los demás años dicen simplemente "TOTAL LOANS". Antes de
cargar 2017 se comparó la magnitud de los saldos contra 2016 y 2018 (la
progresión es continua, sin ningún salto que sugiera un universo de datos
más chico) y se revisó la nota metodológica (1) de la hoja `Observaciones`
de ese mismo archivo, que sí aclara en español que el dato cubre "la
totalidad de las entidades financieras" — igual que en el resto de los
años. Conclusión: es un error de tipeo en la plantilla en inglés de ese
año puntual, no un cambio real de alcance, así que 2017 se cargó igual que
los demás.

### Reemplazo del Excel "limpio" de 2025

El primer archivo que se cargó para 2025 (`PRESTAMOS_AL_SECTOR_AGRO_2025.xlsx`)
era un Excel armado a mano, en formato "limpio", filtrado manualmente a las
12 actividades agro. Una auditoría completa de todo el dataset (2015-2025,
saldos y tasas, con relectura 100% independiente de cada Excel fuente y
chequeos de consistencia numérica) encontró que ese archivo tenía el
**desglose de `SALDOS` por provincia corrido de columna**: a partir de
"Corrientes" en adelante, cada provincia tenía en realidad el valor de la
provincia **dos posiciones antes** en la lista (por ejemplo, la columna
"Tierra del Fuego" tenía el valor real de "Santa Fe"). El total nacional y
toda la hoja `TASAS` (incluida tasas por provincia) no estaban afectados,
solo el desglose de `SALDOS` por provincia. El síntoma que lo delató: la
suma de las 24 provincias no coincidía con el total de la fila (fallaba en
44 de 48 filas de 2025), y provincias chicas como Tierra del Fuego, Jujuy,
Catamarca y Chaco mostraban saltos de hasta 30.000x de un trimestre a otro
mientras provincias grandes como Santa Fe, Salta o La Pampa se desplomaban
a casi cero — ambas cosas, imposibles en la realidad.

La solución fue pedir el export crudo del BCRA para 2025 (mismo formato que
2015-2024) y reemplazar el Excel limpio por
`data/source/PRESTAMOS_AL_SECTOR_AGRO_2025_bcra_crudo.xls`. Este archivo
pasó los mismos controles automáticos que los demás años (validación de
encabezados, suma de provincias = total con <1% de diferencia) y además
mostró continuidad suave con el dato de Dic-24 en las provincias que antes
tenían saltos imposibles. Como beneficio adicional, el crudo BCRA trae el
desglose completo por moneda (pesos/dólares) para las 12 actividades — el
Excel limpio solo lo tenía para 8 (ver debajo). El Excel limpio original no
se usa más en el dataset; el reemplazo se verificó con el mismo proceso de
doble control que el resto de los años.

### Actividades con serie incompleta

Actualmente **no hay ninguna** actividad con serie incompleta: las 12
actividades tienen los 44 trimestres (Mar-15 a Dic-25) completos, con
desglose por moneda en `SALDOS` y `TASAS`. Esto es así desde que se
reemplazó el Excel "limpio" de 2025 por el crudo BCRA equivalente (ver
arriba) — el archivo limpio solo traía el saldo **total** (moneda 0) para 4
de las 12 actividades (granja y otros animales, procesamiento de carnes y
alimentos, elaboración de lácteos, molinería y alimento balanceado), sin
pesos/dólares por separado ni tasa en dólares; el crudo BCRA sí trae el
desglose completo para las 12.

El dashboard igual calcula la completitud en tres niveles por separado
(campos `saldos_total_completo`, `saldos_moneda_completo` y
`tasas_completo` en el JSON, recalculados sobre **todos** los trimestres
combinados, no un número fijo) por si en el futuro una fuente nueva vuelve
a traer menos desglose que las anteriores: en ese caso el dashboard
mostraría igual el gráfico, las tiles y la tabla de provincia en la vista
**Total (US$ equiv.)** con todos los trimestres, pero deshabilitaría las
vistas Pesos/Dólares (avisándolo) y mostraría el aviso de dato parcial en
la pestaña Tasas, sin tocar código.

## Pestaña "Resumen": tasa ponderada, diferencial y pesos vs. dólares

A partir del informe "Crédito al sector agropecuario" que CONINAGRO publica
cada semestre, se sumó una tercera pestaña con tres vistas a nivel nacional
(no por actividad):

1. **Tasa ponderada nacional**: el promedio de la tasa de cada actividad,
   ponderado por el peso de esa actividad sobre el saldo total *de esa
   misma moneda* en el trimestre (pesos pondera con saldo en pesos,
   dólares con saldo en dólares — no es la misma ponderación, porque la
   composición por moneda no es igual en cada actividad). Se calcula en
   `build_resumen_nacional()` (`scripts/build_data.py`) y queda en
   `resumen_nacional` en el JSON, no se recalcula en el navegador.
   Metodología validada contra el propio informe de CONINAGRO: para Jun-25
   (el único trimestre que compartimos con su informe de Jun-26), la tasa
   ponderada en pesos que da nuestra cuenta es 48,95%-49,0% según la base
   de ponderación exacta que se use (se probaron tres: saldo en pesos,
   saldo total en pesos, saldo total en dólares — las tres coinciden entre
   sí a menos de 0,1 punto), contra el 49,3% que publica CONINAGRO. La
   pequeña diferencia (~0,3 puntos) es esperable por redondeos y por cómo
   corta cada uno el dato; se considera una validación exitosa. El dashboard
   muestra esta comparación en la propia vista, para que quede a la vista
   si alguna vez se desalinea.
2. **Diferencial de cada actividad vs. el promedio ponderado**: se calcula
   en el navegador (resta simple, `app.js`), no hace falta guardarlo en el
   JSON. Usa como referencia el trimestre que está en el extremo derecho
   del slider de ventana de tiempo (ver debajo), no siempre el último dato
   publicado.
3. **Costo efectivo: crédito en dólares vs. en pesos**: combina la tasa
   ponderada en dólares con la devaluación interanual (4 trimestres) del
   tipo de cambio, para poder comparar el costo de un crédito en dólares
   contra uno en pesos en igualdad de condiciones — la misma cuenta que
   hace CONINAGRO en su informe, pero calculada para toda la serie
   histórica en vez de un solo período. No hay dato en los primeros 4
   trimestres (2015) porque no hay tipo de cambio de "hace un año" contra
   el cual compararlos.

`build_resumen_nacional()` también valida que el tipo de cambio de la
columna `TC` sea el mismo para todas las actividades de un mismo trimestre
(tiene que serlo, es el TC oficial nacional) y corta con un error si no
-- la misma filosofía de "frenar antes que guardar un dato mal calculado"
que ya usa el resto del script.

## Slider de ventana de tiempo

El control "Ventana de tiempo", debajo del gráfico principal de cada
pestaña, filtra qué trimestres se ven en todos los gráficos (Saldos, Tasas
y Resumen). También recalcula, en vivo, todo lo que depende de "qué
trimestre estamos mirando": la tile "Variación del período" (compara el
extremo izquierdo del slider contra el derecho, no siempre Mar-15 contra
el último dato), la tile "Mix por moneda" (promedio ponderado por saldo de
todos los trimestres visibles, no solo el último), el mapa + ranking por
provincia de Saldos y de Tasas (ver más abajo) y, en la pestaña Resumen,
las tres tiles de tasa/costo efectivo y el trimestre de referencia del
gráfico de diferencial. Todos estos usan el extremo **derecho** de la
ventana elegida (`state.rangeEnd`) como "el trimestre actual" -- si el
slider está en su posición default (todo el rango), coincide con el
último dato disponible; si se lo acota, por ejemplo hasta Mar-25, todos
esos elementos pasan a mostrar Mar-25. Es 100% client-side (`app.js`), no
requiere tocar el JSON. Un mismo `<div class="rangepanel">` se reubica
entre pestañas con `moveRangeSlider()` (`appendChild` a
`#rangeSlot-<tab>`) en vez de duplicarse.

## Mapa de saldo (y de tasa) por provincia

El panel "Saldo por provincia" (pestaña Saldos) y el panel "Tasa por
provincia" (pestaña Tasas) combinan un mapa de Argentina coroplético con
el ranking de las 24 jurisdicciones, lado a lado. Cuanto más oscura una
provincia, mayor su saldo/tasa en la actividad, moneda (segmented
"Total/Pesos/Dólares" en Saldos, "Pesos/Dólares" en Tasas) y **trimestre**
elegidos -- ambos paneles siguen el extremo derecho del slider de
"Ventana de tiempo", no un dato fijo (ver sección anterior). Pasar el
mouse por una provincia del mapa -- o por una fila del listado -- muestra
un tooltip con el monto/tasa y resalta la contraparte (fila ↔ provincia)
para ubicarla fácil.

- **Los datos son series por período, no una foto fija**: cada actividad
  trae `provincias_series` y `tasas_provincias_series` en
  `dashboard_data.json`, un array con un desglose por provincia **por
  cada trimestre** (mismo índice que `periodos`/`series`/`tasas`), en vez
  de un único snapshot del último dato. `app.js` indexa ambos arrays con
  `state.rangeEnd` para saber qué trimestre mostrar. Esto multiplicó el
  peso del JSON (de ~150 KB a ~1,6 MB sin comprimir, ~240 KB con gzip,
  que es lo que efectivamente viaja por red) porque ahora hay 46 fotos en
  vez de 1 -- sigue siendo una sola descarga al cargar la página, nada
  que abra de golpe una app que ya carga Chart.js por CDN.
- **`data/ar_map.json`**: geometría del mapa ya proyectada y lista para
  SVG -- `{ viewBox, paths: { "<nombre de provincia>": "<d de un
  <path>>" }, caba: {x, y} }`. Las 23 provincias vienen de
  [alvarezgarcia/provincias-argentinas-geojson](https://github.com/alvarezgarcia/provincias-argentinas-geojson)
  (GeoJSON público, uno por provincia); CABA no viene en ese repo por ser
  minúscula a esta escala, así que se dibuja como un círculo en su
  centroide (fuente: API de Georef del Ministerio del Interior). Las
  claves de `paths` son exactamente los nombres que ya usa cada entrada de
  `provincias_series`/`tasas_provincias_series` en `dashboard_data.json`
  (`"BS AS"`, `"CABA"`, `"Santiago del estero"`, `"Tierra del fuego"`,
  etc.), así no hace falta ningún diccionario de traducción en el
  frontend.
- Cómo se generó: se bajó el GeoJSON de cada provincia, se proyectaron
  lon/lat con una proyección equirrectangular simple (x = lon·cos(lat₀),
  y = -lat, con lat₀ el promedio de latitud del país) y se simplificó
  cada polígono con Ramer-Douglas-Peucker para que el archivo pese poco
  (~68 KB para las 23 provincias). El script no quedó en el repo porque
  es un paso único (el mapa de Argentina no cambia); si hay que
  regenerarlo o ajustar la simplificación, hay que volver a bajar los 23
  GeoJSON de ese repo.
- **Escala de color** (`provColorScale()` en `app.js`): en vez de una
  escala lineal, usa la raíz cuadrada del saldo relativo al máximo *de la
  vista actual* (misma actividad y moneda). Con escala lineal, como BS
  AS/Córdoba/Santa Fe/CABA concentran la mayoría del crédito en casi
  todas las actividades, el resto de las provincias se verían todas casi
  blancas y no se distinguirían entre sí; con raíz cuadrada se nota mejor
  el escalón entre provincias medianas y chicas. El máximo se recalcula
  para cada actividad/moneda, así que el mapa siempre usa todo el rango
  de contraste disponible (p. ej. en Tabaco, Jujuy y Salta salen bien
  oscuras aunque su saldo sea mucho menor al de BS AS en Total).
- Las provincias sin dato para la moneda elegida se pintan de un gris
  clarito fijo (`.prov-nodata`), no de blanco, para diferenciar "sin
  desglose" de "saldo muy bajo".
- **El panel de Tasas reutiliza el de Saldos**: mismo esquema de mapa +
  ranking completo de las 24 jurisdicciones, coloreado por tasa en vez de
  saldo. Reemplazó a las dos tablas viejas ("Tasas más altas/bajas por
  provincia", top 5 cada una). En `app.js`,
  `makeProvincePanel(mapElId, tooltipElId, bodyElId)` factoriza el manejo
  de tooltip/hover (antes atado a los ids fijos `provMap`/`provTooltip`/
  `provBody`) para que Saldos y Tasas puedan tener cada uno su propia
  instancia (`provPanelSaldos`, `provPanelTasas`) sin duplicar código; el
  armado del SVG y el color siguen en cada `render*` porque difieren
  bastante (moneda + `sqrt` vs. tasa + escala lineal, ver abajo).
- **Selector de moneda propio en Tasas** (`#tasaProvCurSeg`, arriba a la
  derecha del panel, junto al título -- clase `.panelhead` en
  `styles.css`): Pesos/Dólares, independiente del segmented de Saldos y
  también independiente de la leyenda clickeable del gráfico "Tasa
  nacional por trimestre" (esa solo oculta/muestra series del gráfico, no
  cambia qué moneda mira el mapa). Guarda su elección en
  `state.curTasaProv` y solo vuelve a dibujar el panel de provincia
  (`renderTasaProvinceMap`), no toda la vista.
  - **Escala de color distinta**: a diferencia del saldo (unas pocas
    provincias concentran casi todo el crédito → raíz cuadrada desde 0),
    la tasa de interés no tiene esa concentración -- ninguna provincia
    tiene "casi toda la tasa". Por eso el mapa de tasas normaliza
    linealmente entre el mínimo y el máximo *de las provincias con dato
    en esa actividad, moneda y trimestre*, no entre 0 y el máximo: así
    aprovecha todo el degradé en vez de que todo el mapa salga oscuro (si
    usara 0 como piso, con tasas típicamente entre 30% y 90%, casi todas
    las provincias caerían muy cerca del extremo oscuro).
  - **Aviso sobre los 0,0%**: en `tasas_provincias_series[i].pesos`, una
    provincia sin operaciones reportadas para esa actividad/trimestre
    viene como `0.0`, no como `null` (mismo criterio que ya usaba
    `.dolares`). El mapa y el listado los muestran como una tasa real de
    0,0% -- es el mismo comportamiento que ya tenían las tablas viejas de
    "más bajas por provincia" (podían mostrar estos mismos ceros), solo
    que ahora se ven los 24 en vez de 6 y quedan más a la vista. Si en
    algún momento se quiere distinguir "0% real" de "sin operaciones",
    habría que sumar un campo aparte en `build_data.py` (hoy la fuente
    BCRA no lo distingue).

## Formato de montos chicos

Antes, cualquier saldo se mostraba siempre en millones de dólares/pesos con
un decimal, así que un saldo por debajo de los USD 50 mil (común en el
desglose por provincia de una actividad chica) se veía como "US$ 0,0 M" --
un valor que existe pero no se puede leer. `fmtMillones()` en `app.js`
ahora elige la escala según la magnitud: millones si el valor supera el
millón, miles si supera los mil, y el número plano si es menor. El eje Y
del gráfico de evolución de saldo hace lo mismo, pero a nivel de todo el
gráfico (no puede haber dos escalas distintas en un mismo eje): elige
miles o millones según el valor más alto que haya que graficar en la
ventana de tiempo seleccionada.

## Actualizar con un trimestre nuevo

1. Sumá el Excel nuevo en `data/source/` (formato limpio `.xlsx` o crudo
   BCRA `.xls`, los que tengas — no hace falta filtrar el crudo a mano).
2. Corré, pasando **todos** los Excel que quieras combinar (el orden no
   importa, los períodos se ordenan solos):
   ```bash
   pip install openpyxl xlrd
   python3 scripts/build_data.py data/dashboard_data.json \
       data/source/PRESTAMOS_AL_SECTOR_AGRO_2025_bcra_crudo.xls \
       data/source/PRESTAMOS_AL_SECTOR_AGRO_2024_bcra_crudo.xls
   ```
   El script imprime cuántas filas leyó de cada archivo y, al final,
   cuántas actividades y trimestres quedaron en el JSON — conviene mirar
   ese resumen para confirmar que entró lo esperado.
3. Commiteá y subí los cambios — Netlify redespliega solo al detectar el
   push.

No hace falta tocar `index.html`, `styles.css` ni `app.js` para un
trimestre (o un año) nuevo: la cobertura que se ve en el encabezado y el
pie de página se calcula sola a partir de `data/dashboard_data.json`.

## Desarrollo local

Es un sitio 100% estático. Alcanza con:

```bash
python3 -m http.server 8000
```

y abrir `http://localhost:8000`.
