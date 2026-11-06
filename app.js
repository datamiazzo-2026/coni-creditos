(function(){
  async function boot(){
    const [DATA, AR_MAP, INTL] = await Promise.all([
      fetch('data/dashboard_data.json').then(r=>r.json()),
      fetch('data/ar_map.json').then(r=>r.json()),
      fetch('data/internacional.json').then(r=>r.json())
    ]);


  // data/internacional.json se cuelga directamente de DATA (en vez de
  // quedar como variable aparte) para que el resto del archivo lo use igual
  // que cualquier otro dato ya existente (DATA.internacional), sin tener
  // que acordarse de pasar INTL como parámetro extra a cada función.
  DATA.internacional = INTL;

  const PERIODOS = DATA.periodos;
  const PLABEL = DATA.periodos_label;

  const fmt1 = new Intl.NumberFormat('es-AR', {maximumFractionDigits:1, minimumFractionDigits:1});
  const fmtPct = new Intl.NumberFormat('es-AR', {maximumFractionDigits:1, minimumFractionDigits:1});
  const fmtInt = new Intl.NumberFormat('es-AR', {maximumFractionDigits:0});

  // Elige la escala (mil millones / millones / miles / unidad) según la
  // magnitud del valor, para que un monto chico (ej. el saldo de una
  // provincia con poco crédito) no se vea siempre como "0,0 M". El tramo
  // "MM" (mil millones, convención financiera argentina) hace falta desde
  // que se corrigió el bug de unidad de SALDOS (ver build_data.py): los
  // totales nacionales y de las actividades más grandes ahora entran en
  // los billones de pesos (miles de millones), no solo en millones.
  function pickScale(maxAbs){
    if(maxAbs >= 1e9) return {div:1e9, suf:' MM'};
    if(maxAbs >= 1e6) return {div:1e6, suf:' M'};
    if(maxAbs >= 1e3) return {div:1e3, suf:' K'};
    return {div:1, suf:''};
  }
  function fmtMillones(v, prefix){
    if(v===null||v===undefined) return '—';
    const scale = pickScale(Math.abs(v));
    if(scale.div===1) return prefix + ' ' + fmtInt.format(v);
    return prefix + ' ' + fmt1.format(v/scale.div) + scale.suf;
  }
  // Saldo producto: mismo esquema de escala que fmtMillones, pero la unidad
  // va DESPUÉS del número (kg, t, l, cajas) en vez de un prefijo de moneda
  // antes. "kg" se muestra convertido a toneladas (dividiendo por 1000)
  // porque los valores en kg quedan en cientos de millones y son ilegibles
  // tal cual -- el resto de las unidades (t, l, caja de 18kg) ya vienen en
  // una escala razonable del archivo de precios y no se convierten.
  function fmtUnidadProducto(v, unidadBase){
    if(v===null||v===undefined) return '—';
    let val = v, unidad = unidadBase;
    if(unidadBase==='kg'){ val = v/1000; unidad = 't'; }
    else if(unidadBase==='caja de 18kg'){ unidad = 'cajas de 18kg'; }
    const scale = pickScale(Math.abs(val));
    const num = scale.div===1 ? fmtInt.format(val) : fmt1.format(val/scale.div)+scale.suf;
    return num + ' ' + unidad;
  }
  // "Pesos constantes": saldo total en pesos, ajustado por inflación a
  // precios del ÚLTIMO trimestre de la serie (hoy Jun-26 -- se recalcula
  // solo, usa PERIODOS[PERIODOS.length-1] en vez de tener la fecha
  // hardcodeada). El ajuste lo hace build_data.py con el índice de precios
  // de data/ipc_indice_mensual.csv (promedio de los 3 meses de cada
  // trimestre), no el frontend -- acá solo se lee el campo ya calculado
  // `total_ars_constante`. Por eso mismo trimestre el último valor de la
  // serie queda siempre igual al saldo en pesos corrientes (factor 1).
  function currencyMeta(cur){
    if(cur==='pesos') return {prefix:'$', field:'pesos_ars', provField:'pesos_ars', label:'en pesos'};
    if(cur==='dolares') return {prefix:'US$', field:'dolares_usd', provField:'dolares_usd', label:'en dólares'};
    if(cur==='constante') return {prefix:'$', field:'total_ars_constante', provField:'total_ars_constante',
      label:'a precios constantes de '+PLABEL[PERIODOS[PERIODOS.length-1]]};
    return {prefix:'US$', field:'total_usd', provField:'total_usd', label:'total, equivalente en US$'};
  }

  // "Total Agro": actividad sintética que agrega las 21 actividades reales
  // (pedido de Ciro, Oct-2026) -- va FIJA arriba de la lista alfabética del
  // sidebar (no se mezcla con ella) y es la que se ve por defecto al abrir
  // el sitio, tanto en Saldos como en Tasas. No se arma con una corrida
  // nueva de build_data.py: se calcula acá mismo, en el navegador, a partir
  // de datos que YA están en dashboard_data.json --
  //   - Panorama/Evolución/Monedas (Saldos) salen de `resumen_nacional` (RN),
  //     que ya trae el total agregado de las 21 actividades por trimestre
  //     (pesos, dólares, total en US$ equiv. y tipo de cambio) -- es el mismo
  //     dato que ya usa la tarjeta "Participación" de cada actividad.
  //   - "Pesos constantes" no viene en RN, así que se reconstruye: el factor
  //     de deflación de un trimestre es el mismo para TODAS las actividades
  //     (depende solo del IPC de ese trimestre, no de la actividad), así que
  //     alcanza con sacarlo de una sola actividad cualquiera (total_ars_constante
  //     / total_ars de ese trimestre) y aplicárselo al total nacional.
  //   - Provincias (Saldos) se arma sumando, provincia por provincia y
  //     trimestre por trimestre, el desglose de las 21 actividades
  //     (act.provincias_series).
  //   - Tasas: usa directamente RN.tasa_pesos_ponderada/tasa_dolares_ponderada/
  //     costo_efectivo_dolares (el contenido que antes vivía en la extinta
  //     pestaña "Resumen" -- ver renderTasasView) en vez de `act.tasas`, así
  //     que esta actividad sintética NO tiene campo `tasas` propio.
  // No tiene "saldo producto" (no hay un "producto" único para todo el agro)
  // ni "Participación" (comparado contra sí mismo siempre daría 100%) -- ver
  // el manejo de ID_TOTAL_AGRO en el nav de pestañas y en el click del
  // sidebar, más abajo.
  const ID_TOTAL_AGRO = 'total-agro';
  function buildTotalAgroActividad(){
    const refSeries = DATA.actividades[0].series;
    const RN0 = DATA.resumen_nacional || [];
    const series = PERIODOS.map((per, i)=>{
      const rn = RN0[i];
      if(!rn) return null;
      const ref = refSeries[i];
      const deflator = (ref && ref.total_ars) ? (ref.total_ars_constante / ref.total_ars) : 1;
      const totalArs = rn.total_ars_nacional;
      return {
        periodo: rn.periodo,
        tc: rn.tc,
        total_ars: totalArs,
        pesos_ars: rn.pesos_ars_nacional,
        dolares_usd: rn.dolares_usd_nacional,
        total_usd: (totalArs!=null && rn.tc) ? totalArs/rn.tc : null,
        total_ars_constante: totalArs!=null ? totalArs*deflator : null,
        saldo_producto: null,
      };
    });

    const PROV_FIELDS = ['total_ars','pesos_ars','dolares_usd','total_usd','total_ars_constante'];
    const provincias_series = PERIODOS.map((per, i)=>{
      const out = {}; PROV_FIELDS.forEach(f=>{ out[f] = {}; });
      DATA.actividades.forEach(act=>{
        const entry = act.provincias_series && act.provincias_series[i];
        if(!entry) return;
        PROV_FIELDS.forEach(f=>{
          const dict = entry[f];
          if(!dict) return;
          Object.entries(dict).forEach(([prov,val])=>{
            if(val==null) return;
            out[f][prov] = (out[f][prov]||0) + val;
          });
        });
      });
      return out;
    });

    return {
      id: ID_TOTAL_AGRO, nombre: 'Total Agro', esTotalAgro: true,
      saldo_producto_disponible: false,
      saldos_total_completo: true, saldos_moneda_completo: true,
      series, provincias_series,
    };
  }
  const TOTAL_AGRO_ACT = buildTotalAgroActividad();

  const state = { tab:'saldos', actId: ID_TOTAL_AGRO, cur:'total', curTasaProv:'pesos', tasaPesosMode:'nominal', rangeStart:0, rangeEnd: PERIODOS.length-1, sectorPeriodoIdx: PERIODOS.length-1, curSectores:'corriente', composicionPeriodoIdx: PERIODOS.length-1, curComposicion:'total', diffExpanded:false, evolMode:'saldo' };

  // Panel de mapa + ranking por provincia: lo usan tanto Saldos (por moneda)
  // como Tasas (por tasa en pesos). En vez de duplicar el manejo de tooltip
  // y hover para cada uno, un mismo helper devuelve las funciones atadas a
  // los ids de cada pestaña.
  function makeProvincePanel(mapElId, tooltipElId, bodyElId){
    const tooltipEl = document.getElementById(tooltipElId);
    const mapWrapEl = document.getElementById(mapElId);
    function showTooltip(html, evt){
      if(!tooltipEl) return;
      tooltipEl.innerHTML = html;
      tooltipEl.style.display = 'block';
      moveTooltip(evt);
    }
    function moveTooltip(evt){
      if(!tooltipEl || !evt) return;
      const pad = 14;
      let x = evt.clientX + pad, y = evt.clientY + pad;
      const rect = tooltipEl.getBoundingClientRect();
      if(x + rect.width > window.innerWidth - 8) x = evt.clientX - rect.width - pad;
      if(y + rect.height > window.innerHeight - 8) y = evt.clientY - rect.height - pad;
      tooltipEl.style.left = x+'px';
      tooltipEl.style.top = y+'px';
    }
    function hideTooltip(){ if(tooltipEl) tooltipEl.style.display = 'none'; }
    function setHover(name){
      if(mapWrapEl) mapWrapEl.querySelectorAll('[data-prov]').forEach(function(el){
        el.classList.toggle('prov-hover', name!==null && el.dataset.prov===name);
      });
      const body = document.getElementById(bodyElId);
      if(body) body.querySelectorAll('tr[data-prov]').forEach(function(tr){
        tr.classList.toggle('prov-hover', name!==null && tr.dataset.prov===name);
      });
    }
    return { mapWrapEl, showTooltip, moveTooltip, hideTooltip, setHover };
  }
  const provPanelSaldos = makeProvincePanel('provMap','provTooltip','provBody');
  const provPanelTasas = makeProvincePanel('tasaProvMap','tasaProvTooltip','tasaProvBody');

  // El SVG del mapa (paths + listeners de hover) se arma una sola vez por
  // pestaña -- ver `mapEl.dataset.built` más abajo -- para no reconstruir
  // 24 paths en cada render. Pero los VALORES que muestra el tooltip al
  // pasar el mouse (saldo/tasa por provincia) cambian con la actividad, la
  // moneda o el trimestre elegidos, que sí se recalculan en cada render.
  // Si el listener de "mouseenter" leyera esos valores de variables
  // capturadas en el momento de construir el SVG, quedarían congelados en
  // los de la primera vez que se dibujó el mapa -- el color del mapa se
  // actualizaría bien (eso pasa afuera del `if(!dataset.built)`) pero el
  // tooltip mostraría siempre los datos de la actividad inicial. Por eso
  // el listener lee de estos dos objetos "vivos", que SÍ se reescriben en
  // cada render (ver renderProvinceTable/renderTasaProvinceMap), en vez de
  // cerrar sobre variables locales de la llamada que construyó el SVG.
  let provMapLiveSaldos = { valByProv:{}, total:0 };
  let provMapLiveTasas = { valByProv:{}, min:0, max:0, span:1 };

  // ---------- Slider de ventana de tiempo (compartido entre pestañas) ----------
  const rangeMin = document.getElementById('rangeMin');
  const rangeMax = document.getElementById('rangeMax');
  const rangeFill = document.getElementById('rangeFill');
  const rangeValueLabel = document.getElementById('rangeValueLabel');

  // Segundo par de inputs, al pie del gráfico de Internacional (pedido de
  // Ciro, Nov-2026: con 46 trimestres el eje X quedaba amontonado -- mejor
  // un slider ahí mismo, como el de Panorama, para no tener que scrollear
  // hasta arriba cada vez que se quiere acotar el período). NO es un rango
  // independiente: lee y escribe el mismo state.rangeStart/rangeEnd de
  // siempre, así que mover cualquiera de los dos sliders mueve el otro
  // también (ver updateRangeUI) y afecta a todos los gráficos de Saldos,
  // no solo a este.
  const intlRangeMin = document.getElementById('internacionalRangeMin');
  const intlRangeMax = document.getElementById('internacionalRangeMax');
  const intlRangeFill = document.getElementById('internacionalRangeFill');
  const intlRangeValueLabel = document.getElementById('internacionalRangeValueLabel');

  function updateRangeUI(){
    const a = state.rangeStart, b = state.rangeEnd;
    const lastIdx = PERIODOS.length-1;
    const pctA = lastIdx ? (a/lastIdx*100) : 0;
    const pctB = lastIdx ? (b/lastIdx*100) : 100;
    rangeFill.style.left = pctA+'%';
    rangeFill.style.right = (100-pctB)+'%';
    rangeValueLabel.textContent = PLABEL[PERIODOS[a]]+' — '+PLABEL[PERIODOS[b]];
    if(intlRangeMin){
      intlRangeMin.value = String(a);
      intlRangeMax.value = String(b);
      intlRangeFill.style.left = pctA+'%';
      intlRangeFill.style.right = (100-pctB)+'%';
      intlRangeValueLabel.textContent = PLABEL[PERIODOS[a]]+' — '+PLABEL[PERIODOS[b]];
    }
  }
  if(PERIODOS.length>1){
    rangeMin.max = rangeMax.max = String(PERIODOS.length-1);
    rangeMin.value = String(state.rangeStart);
    rangeMax.value = String(state.rangeEnd);
    rangeMin.addEventListener('input', ()=>{
      let a = Number(rangeMin.value);
      if(a > state.rangeEnd){ a = state.rangeEnd; rangeMin.value = String(a); }
      state.rangeStart = a;
      updateRangeUI(); renderAll();
    });
    rangeMax.addEventListener('input', ()=>{
      let b = Number(rangeMax.value);
      if(b < state.rangeStart){ b = state.rangeStart; rangeMax.value = String(b); }
      state.rangeEnd = b;
      updateRangeUI(); renderAll();
    });
    if(intlRangeMin){
      intlRangeMin.max = intlRangeMax.max = String(PERIODOS.length-1);
      intlRangeMin.value = String(state.rangeStart);
      intlRangeMax.value = String(state.rangeEnd);
      intlRangeMin.addEventListener('input', ()=>{
        let a = Number(intlRangeMin.value);
        if(a > state.rangeEnd){ a = state.rangeEnd; intlRangeMin.value = String(a); }
        state.rangeStart = a;
        rangeMin.value = String(a);
        updateRangeUI(); renderAll();
      });
      intlRangeMax.addEventListener('input', ()=>{
        let b = Number(intlRangeMax.value);
        if(b < state.rangeStart){ b = state.rangeStart; intlRangeMax.value = String(b); }
        state.rangeEnd = b;
        rangeMax.value = String(b);
        updateRangeUI(); renderAll();
      });
    }
  } else {
    document.querySelector('.rangepanel').style.display = 'none';
    const intlBlock = document.getElementById('internacionalRangeBlock');
    if(intlBlock) intlBlock.style.display = 'none';
  }
  updateRangeUI();

  // El slider es un único elemento compartido entre pestañas (mismo estado,
  // mismos listeners) -- en vez de duplicarlo, lo movemos con appendChild
  // al slot de la pestaña activa, siempre debajo del gráfico principal. En
  // Tasas, "Total Agro" tiene su propio slot (rangeSlot-tasas-totalagro,
  // dentro de resumen-panorama) porque vive en una sección distinta a la
  // de las actividades reales (rangeSlot-tasas, dentro de tasas-panorama) --
  // sin esto, el slider quedaría movido dentro de una sección oculta.
  function moveRangeSlider(){
    let slotKey = state.tab;
    if(state.tab==='tasas' && getAct(state.actId).esTotalAgro) slotKey = 'tasas-totalagro';
    const slot = document.getElementById('rangeSlot-'+slotKey);
    const panel = document.querySelector('.rangepanel');
    if(slot && panel) slot.appendChild(panel);
  }
  moveRangeSlider();

  // Cobertura de datos (encabezado y pie), calculada de PERIODOS en vez de
  // quedar hardcodeada: así no hay que tocar el HTML cada vez que se suma
  // un año nuevo.
  (function setCoverageLabels(){
    const first = PLABEL[PERIODOS[0]], last = PLABEL[PERIODOS[PERIODOS.length-1]];
    const rango = first+' a '+last;
    const coverageEl = document.getElementById('coverageLabel');
    if(coverageEl) coverageEl.textContent = rango;
    const footerEl = document.getElementById('footerCoverage');
    if(footerEl) footerEl.textContent = rango;
  })();

  function getAct(id){ return id===ID_TOTAL_AGRO ? TOTAL_AGRO_ACT : DATA.actividades.find(a=>a.id===id); }

  // ---------- Activity sidebar ----------
  // El orden de DATA.actividades (el que arma build_data.py, agrupado por
  // rubro: agrícola, pecuario, agroindustrial) sigue siendo el que usan el
  // resto de las vistas -- ej. el activo por default (DATA.actividades[0])
  // o el orden de las barras en "Diferencial de cada actividad" de Resumen
  // (que de todos modos se reordena por valor, no por esta lista). Acá, para
  // el listado de la izquierda, se muestra una COPIA ordenada alfabéticamente
  // (sensibilidad "base": ignora mayúsculas/acentos para no separar, por
  // ejemplo, "Elaboración" de una hipotética "Elaboracion" sin tilde) --
  // nunca se reordena el array original.
  const ACTIVIDADES_ALFABETICO = DATA.actividades.slice()
    .sort((a,b)=> a.nombre.localeCompare(b.nombre, 'es', {sensitivity:'base'}));

  function renderPills(container, onClick){
    container.innerHTML='';
    // "Total Agro" va fija arriba de la lista alfabética, no mezclada con
    // ella -- pedido explícito de Ciro ("arriba de Bovinos"). Tiene vista
    // propia tanto en Saldos como en Tasas, así que elegirla se comporta
    // igual que elegir cualquier otra actividad: no hace falta forzar
    // ningún cambio de pestaña (a diferencia de versiones anteriores).
    const bTotal = document.createElement('button');
    bTotal.className = 'sbrow sbrow-pinned' + (ID_TOTAL_AGRO===state.actId ? ' active':'');
    bTotal.innerHTML = '<span>'+TOTAL_AGRO_ACT.nombre+'</span>';
    bTotal.addEventListener('click', ()=>{ state.actId = ID_TOTAL_AGRO; onClick(); });
    container.appendChild(bTotal);
    ACTIVIDADES_ALFABETICO.forEach(a=>{
      const b = document.createElement('button');
      b.className = 'sbrow' + (a.id===state.actId ? ' active':'');
      const limitada = !a.saldos_moneda_completo || !a.tasas_completo;
      const composicion = ACTIVIDAD_COMPOSICION[a.id];
      b.innerHTML = '<span>'+a.nombre+'</span>'
        + (limitada ? '<span class="dot" title="Datos parciales: ver aviso en la vista"></span>' : '')
        + (composicion ? '<span class="dot agg" title="Actividad agregada por el BCRA"></span>'
          + '<span class="seg-item"><span class="info-icon-btn" tabindex="0" aria-label="¿Qué incluye esta actividad?">ⓘ</span>'
          + '<div class="seg-tooltip" role="tooltip"><b>¿Qué incluye esta actividad?</b>'+composicion+'</div></span>' : '');
      b.addEventListener('click', (e)=>{ if(e.target.closest('.seg-item')) return; state.actId=a.id; onClick(); });
      container.appendChild(b);
      if(composicion) wireInfoTooltip(b.querySelector('.seg-item'));
    });
  }

  // ---------- Tabs ----------
  document.getElementById('tabsNav').addEventListener('click', (e)=>{
    const btn = e.target.closest('button[data-tab]');
    if(!btn) return;
    state.tab = btn.dataset.tab;
    [...document.getElementById('tabsNav').children].forEach(c=>c.classList.toggle('active', c===btn));
    document.getElementById('view-saldos').style.display = state.tab==='saldos' ? '' : 'none';
    document.getElementById('view-tasas').style.display = state.tab==='tasas' ? '' : 'none';
    document.getElementById('view-comercial').style.display = state.tab==='comercial' ? '' : 'none';
    // "Financiamiento" es nacional (no por actividad), así que no necesita el
    // panel de actividades de la izquierda -- se lo esconde con la misma
    // clase que ya usa el resto del layout para un main sin sidebar.
    document.getElementById('mainGrid').classList.toggle('no-sidebar', state.tab==='comercial');
    // El pie de página de Saldos/Tasas dice "Fuente: ... BCRA" -- no aplica
    // a Financiamiento (fuente distinta, Bolsa de Comercio de Rosario, con
    // su propio rango de campañas), así que se cambia el pie entero en vez
    // de dejar ese texto fijo colgando debajo de datos de otra fuente.
    document.getElementById('mainFooter').style.display = state.tab==='comercial' ? 'none' : '';
    document.getElementById('comercialFooter').style.display = state.tab==='comercial' ? '' : 'none';
    moveRangeSlider();
    renderAll();
  });

  document.getElementById('curSeg').addEventListener('click', (e)=>{
    const btn = e.target.closest('button[data-cur]');
    if(!btn || btn.disabled) return;
    state.cur = btn.dataset.cur;
    // querySelectorAll (no .children) porque "Pesos constantes" quedó
    // envuelto en un <span class="seg-item"> para poder anclarle el cuadro
    // de referencia (#constanteTooltip) -- ya no es un hijo directo de
    // #curSeg como los otros tres botones.
    document.getElementById('curSeg').querySelectorAll('button[data-cur]').forEach(c=>c.classList.toggle('active', c===btn));
    renderSaldosView();
  });

  // Toggle del gráfico de Evolución: "Saldo" (el de siempre, en la moneda
  // elegida arriba en Panorama) vs "Saldo producto" (cantidad física
  // equivalente, ver renderTiles). Es independiente de #curSeg porque
  // saldo producto no tiene "moneda" -- siempre se expresa en su propia
  // unidad (t, l, kg, cajas). Si la actividad no tiene saldo producto,
  // ese botón queda deshabilitado (ver renderSaldosView).
  document.getElementById('evolModeSeg').addEventListener('click', (e)=>{
    const btn = e.target.closest('button[data-evolmode]');
    if(!btn || btn.disabled) return;
    state.evolMode = btn.dataset.evolmode;
    document.getElementById('evolModeSeg').querySelectorAll('button[data-evolmode]').forEach(c=>c.classList.toggle('active', c===btn));
    renderChart(getAct(state.actId));
  });

  // Cuadro de referencia de "Pesos constantes": explica en lenguaje llano
  // qué significa esa vista, para público general que no necesariamente
  // sabe qué es "ajustar por inflación". Aparece al pasar el mouse (hover,
  // desktop) o al tocar el botón (mobile, que no tiene hover -- se muestra
  // unos segundos y se cierra sola).
  (function initConstanteTooltip(){
    const wrap = document.querySelector('#curSeg .seg-item');
    const tip = document.getElementById('constanteTooltip');
    if(!wrap || !tip) return;
    const MESES_LARGOS = {'03':'marzo','06':'junio','09':'septiembre','12':'diciembre'};
    const perStr = String(PERIODOS[PERIODOS.length-1]);
    const labelLargo = (MESES_LARGOS[perStr.slice(4,6)] || perStr.slice(4,6)) + ' de ' + perStr.slice(0,4);
    tip.innerHTML = '<b>¿Qué es "Pesos constantes"?</b>Significa descontar la inflación: cada valor histórico se muestra como si estuviera expresado en pesos de <b>'+labelLargo+'</b>.';

    // Posición horizontal: en vez de un breakpoint fijo (el botón puede
    // terminar pegado a la izquierda o a la derecha según cuánto ancho tenga
    // el panel en cada momento, porque ".segmented" hace flex-wrap -- ver
    // comentario en styles.css), se mide la posición real del botón cada vez
    // que el cuadro está por abrirse y se centra el cuadro debajo de él,
    // recortando contra los bordes de la pantalla si no entra. La flechita
    // (::after) se corrige aparte para que siga apuntando al botón real aunque
    // el cuadro se haya corrido para no salirse de la pantalla.
    function positionTooltip(){
      const wrapRect = wrap.getBoundingClientRect();
      const tipWidth = tip.getBoundingClientRect().width;
      const pad = 16;
      const idealCenter = wrapRect.left + wrapRect.width/2;
      const idealLeft = idealCenter - tipWidth/2;
      const maxLeft = window.innerWidth - tipWidth - pad;
      const clampedLeft = Math.max(pad, Math.min(idealLeft, Math.max(pad, maxLeft)));
      tip.style.setProperty('--tooltip-left', (clampedLeft - wrapRect.left) + 'px');
      tip.style.setProperty('--tooltip-transform', 'none');
      const arrowMin = 14, arrowMax = tipWidth - 14;
      const arrowLeft = Math.max(arrowMin, Math.min(idealCenter - clampedLeft, arrowMax));
      tip.style.setProperty('--arrow-left', arrowLeft + 'px');
    }

    let hideTimer = null;
    // Al tocar un botón, el navegador también le da foco como parte del tap
    // (se ve un "click" disparado unos ms después del touchstart, que mueve
    // el foco al <button>). Eso dispara "focusin" en este wrapper, y como
    // nunca llega un "focusout" después (nada más le quita el foco en
    // mobile), un show() sin guardar ahí cancelaba (vía clearTimeout) el
    // auto-cierre de 3,5s que programó el touchstart, y el cuadro quedaba
    // abierto para siempre. Por eso mouseenter/mouseleave Y focusin/focusout
    // se ignoran mientras touchLock esté activo: en touch, el touchstart ya
    // se encarga de mostrar y de programar su propio cierre.
    let touchLock = false;
    function show(){ clearTimeout(hideTimer); positionTooltip(); tip.classList.add('visible'); }
    function hide(delay){ clearTimeout(hideTimer); hideTimer = setTimeout(()=> tip.classList.remove('visible'), delay || 0); }
    wrap.addEventListener('mouseenter', ()=>{ if(!touchLock) show(); });
    wrap.addEventListener('mouseleave', ()=>{ if(!touchLock) hide(0); });
    wrap.addEventListener('focusin', ()=>{ if(!touchLock) show(); });
    wrap.addEventListener('focusout', ()=>{ if(!touchLock) hide(0); });
    wrap.addEventListener('touchstart', ()=>{
      touchLock = true;
      show();
      hide(3500);
      setTimeout(()=>{ touchLock = false; }, 700);
    }, {passive:true});
  })();

  // Versión reutilizable de initConstanteTooltip() de arriba, para los
  // cuadros de referencia de "Saldo producto" y "Tasa producto" (pedido de
  // Ciro, Oct-2026: "lo mismo que tenemos en pesos constantes" para estas
  // dos secciones nuevas). Misma mecánica exacta (mismo CSS .seg-item/
  // .seg-tooltip, mismo manejo de hover/foco/touch) -- se factoriza en vez
  // de duplicarla una tercera vez. `wrapSelector` tiene que resolver a un
  // elemento con class="seg-item" que contenga el trigger (botón o ícono)
  // y, como hijo, el <div class="seg-tooltip">.
  // `wireInfoTooltip(wrap, html)` hace el trabajo real sobre un elemento ya
  // resuelto (wrap = el .seg-item que contiene el trigger y, como hijo, el
  // <div class="seg-tooltip">). `initInfoTooltip(selector, html)` es el modo
  // de uso original (un único elemento estático, resuelto por selector) --
  // se mantiene igual para no tocar los 2 usos que ya había. La versión por
  // elemento permite además wirear tooltips en filas creadas dinámicamente
  // (ver ACTIVIDAD_COMPOSICION / renderPills más abajo, Nov-2026), donde no
  // hay un selector único fijo sino uno por fila.
  function wireInfoTooltip(wrap, html){
    const tip = wrap && wrap.querySelector('.seg-tooltip');
    if(!wrap || !tip) return;
    if(html!=null) tip.innerHTML = html;

    function positionTooltip(){
      const wrapRect = wrap.getBoundingClientRect();
      const tipWidth = tip.getBoundingClientRect().width;
      const pad = 16;
      const idealCenter = wrapRect.left + wrapRect.width/2;
      const idealLeft = idealCenter - tipWidth/2;
      const maxLeft = window.innerWidth - tipWidth - pad;
      const clampedLeft = Math.max(pad, Math.min(idealLeft, Math.max(pad, maxLeft)));
      // ".tile-tooltip" (tarjetas, ver tileSaldoProducto más abajo): position:fixed
      // en vez de absolute, con left/top en coordenadas de viewport puestas acá
      // mismo -- las tarjetas viven dentro de #tiles, que tiene overflow:hidden
      // (para los bordes redondeados de la grilla) y recortaría un tooltip
      // absolute antes de que llegue a verse. Con fixed no hace falta ningún
      // padre position:relative, así que el calc(100%...) del CSS no aplica acá.
      if(tip.classList.contains('tile-tooltip')){
        tip.style.left = clampedLeft + 'px';
        tip.style.top = (wrapRect.bottom + 9) + 'px';
      } else {
        tip.style.setProperty('--tooltip-left', (clampedLeft - wrapRect.left) + 'px');
        tip.style.setProperty('--tooltip-transform', 'none');
      }
      const arrowMin = 14, arrowMax = tipWidth - 14;
      const arrowLeft = Math.max(arrowMin, Math.min(idealCenter - clampedLeft, arrowMax));
      tip.style.setProperty('--arrow-left', arrowLeft + 'px');
    }

    let hideTimer = null;
    let touchLock = false;
    function show(){ clearTimeout(hideTimer); positionTooltip(); tip.classList.add('visible'); }
    function hide(delay){ clearTimeout(hideTimer); hideTimer = setTimeout(()=> tip.classList.remove('visible'), delay || 0); }
    wrap.addEventListener('mouseenter', ()=>{ if(!touchLock) show(); });
    wrap.addEventListener('mouseleave', ()=>{ if(!touchLock) hide(0); });
    wrap.addEventListener('focusin', ()=>{ if(!touchLock) show(); });
    wrap.addEventListener('focusout', ()=>{ if(!touchLock) hide(0); });
    wrap.addEventListener('touchstart', (e)=>{
      e.stopPropagation();
      touchLock = true;
      show();
      hide(3500);
      setTimeout(()=>{ touchLock = false; }, 700);
    }, {passive:true});
  }
  function initInfoTooltip(wrapSelector, html){
    wireInfoTooltip(document.querySelector(wrapSelector), html);
  }
  initInfoTooltip('#evolModeSeg .seg-item',
    '<b>¿Qué es "Saldo producto"?</b>Convierte el saldo de crédito en la cantidad física equivalente del producto de esta actividad (toneladas, litros, kg o cajas, según corresponda), dividiendo el saldo por el precio de ese producto en el mismo trimestre.');
  initInfoTooltip('#tasas-producto .seg-item',
    '<b>¿Qué es "Tasa producto"?</b>Es la diferencia, en puntos porcentuales, entre cuánto subió la tasa de financiamiento de esta actividad y cuánto subió el precio de su propio producto en los últimos 12 meses. Positivo (rojo): creció más la tasa. Negativo (verde): creció más el precio.');

  // Nota metodológica puntual para actividades donde el BCRA agrupa, bajo
  // una sola categoría, más de un rubro real (pedido de Ciro, Nov-2026, a
  // raíz de una consulta recibida: "hay que explicar qué es el dato que
  // están viendo"). Mismo estilo exacto que "Pesos constantes" / "Saldo
  // producto" / "Tasa producto" (misma clase .seg-item/.seg-tooltip, mismo
  // ícono "ⓘ"), aplicado acá solo a las actividades cuyo propio nombre
  // completo (ver DATA.actividades) ya deja ver que son una agregación
  // explícita. No se incluyen TODAS las actividades con alguna salvedad
  // (p.ej. las "excepto ...") -- solo las que agrupan rubros distintos bajo
  // un mismo número.
  const ACTIVIDAD_COMPOSICION = {
    'tabaco': 'El BCRA agrupa en esta categoría el cultivo de tabaco junto con la elaboración de productos de tabaco (cigarrillos, etc.).',
    'madera': 'Agrupa la silvicultura y extracción de madera junto con la industria maderera (aserraderos, fabricación de productos de madera).',
    'otros-pecuarios': 'Incluye cría de equinos, caprinos, animales en cabañas y haras, producción de lana y pelos, y otras producciones pecuarias menores. No incluye bovino, ovino, porcino ni producción de leche, que tienen tarjeta propia.',
    'produccion-y-procesamiento-de-': 'Agrupa el procesamiento industrial de carnes, pescado, frutas, legumbres y hortalizas, junto con la elaboración de aceites y grasas.',
    'elaboracion-de-productos-de-mo': 'Agrupa la elaboración de productos de molinería (harinas, almidones y derivados) junto con la fabricación de alimentos balanceados para animales.',
  };

  document.getElementById('tasaProvCurSeg').addEventListener('click', (e)=>{
    const btn = e.target.closest('button[data-cur]');
    if(!btn) return;
    state.curTasaProv = btn.dataset.cur;
    [...document.getElementById('tasaProvCurSeg').children].forEach(c=>c.classList.toggle('active', c===btn));
    renderTasaProvinceMap(getAct(state.actId));
  });

  document.getElementById('tasaPesosModeSeg').addEventListener('click', (e)=>{
    const btn = e.target.closest('button[data-mode]');
    if(!btn) return;
    state.tasaPesosMode = btn.dataset.mode;
    [...document.getElementById('tasaPesosModeSeg').children].forEach(c=>c.classList.toggle('active', c===btn));
    renderTasaPesosChart(getAct(state.actId));
  });

  const sectoresCurSegEl = document.getElementById('sectoresCurSeg');
  if(sectoresCurSegEl){
    sectoresCurSegEl.addEventListener('click', (e)=>{
      const btn = e.target.closest('button[data-cur]');
      if(!btn) return;
      state.curSectores = btn.dataset.cur;
      [...sectoresCurSegEl.children].forEach(c=>c.classList.toggle('active', c===btn));
      renderSectoresChart();
    });
  }

  const composicionCurSegEl = document.getElementById('composicionCurSeg');
  if(composicionCurSegEl){
    composicionCurSegEl.addEventListener('click', (e)=>{
      const btn = e.target.closest('button[data-cur]');
      if(!btn) return;
      state.curComposicion = btn.dataset.cur;
      [...composicionCurSegEl.children].forEach(c=>c.classList.toggle('active', c===btn));
      renderComposicionChart();
    });
  }

  let evolChart, tasaPesosChart, tasaDolaresChart, tasaProductoChart, participChart, mixChart;

  // Misma idea que currencyMeta(), pero para la participación en el crédito
  // agro total: a diferencia del resto de la vista Saldos (que en "Total"
  // muestra el equivalente en US$), la participación siempre compara ARS
  // contra ARS o USD contra USD dentro de la misma moneda -- el resultado es
  // igual de todas formas (dividir dos montos en US$ da el mismo cociente que
  // dividirlos en ARS, porque ambos usan el mismo tipo de cambio de ese
  // trimestre), así que se usa directamente el campo en pesos/total_ars ya
  // presente en la serie. 'denom' apunta al campo de resumen_nacional con la
  // suma de esa moneda específica entre las 21 actividades (ver
  // build_resumen_nacional() en build_data.py).
  function participMeta(cur){
    if(cur==='pesos') return {field:'pesos_ars', denom:'pesos_ars_nacional', label:'en pesos'};
    if(cur==='dolares') return {field:'dolares_usd', denom:'dolares_usd_nacional', label:'en dólares'};
    return {field:'total_ars', denom:'total_ars_nacional', label:'total, equivalente en US$'};
  }

  // Gráfico histórico de participación: para cada trimestre de la ventana
  // elegida, qué porcentaje del crédito agro total (en la moneda que esté
  // seleccionada arriba) representa la actividad elegida. El denominador de
  // cada trimestre es la suma de esa misma moneda entre las 21 actividades
  // (resumen_nacional), no un valor fijo -- por eso el gráfico cambia tanto
  // si se cambia de actividad como si se cambia de moneda.
  function renderParticipChart(act){
    const pm = participMeta(state.cur);
    const periodosVisible = PERIODOS.slice(state.rangeStart, state.rangeEnd+1);
    const labels = periodosVisible.map(p=>PLABEL[p]);
    const seriesVisible = act.series.slice(state.rangeStart, state.rangeEnd+1);
    const rnVisible = RN.slice(state.rangeStart, state.rangeEnd+1);
    const values = seriesVisible.map((s,i)=>{
      const rn = rnVisible[i];
      const num = s ? s[pm.field] : null;
      const den = rn ? rn[pm.denom] : null;
      if(num===null || num===undefined || !den) return null;
      return num/den*100;
    });

    const styles = getComputedStyle(document.documentElement);
    const accent = styles.getPropertyValue('--accent').trim();
    const textColor = styles.getPropertyValue('--text-muted').trim();
    const gridColor = styles.getPropertyValue('--border').trim();

    const ctx = document.getElementById('participChart').getContext('2d');
    if(participChart) participChart.destroy();
    participChart = new Chart(ctx, {
      type:'line',
      data:{ labels, datasets:[{
        label:'Participación',
        data: values,
        borderColor: accent, backgroundColor: accent, tension:.25, pointRadius:2, spanGaps:false,
      }]},
      options:{
        responsive:true, maintainAspectRatio:false,
        plugins:{ legend:{display:false}, tooltip:{ callbacks:{ label:(c)=> c.raw!=null?fmtPct.format(c.raw)+'%':'sin dato' } } },
        scales:{
          x:{ grid:{display:false}, ticks:{ color:textColor, font:{size:11}, maxRotation:0, autoSkip:true } },
          y:{ grid:{ color:gridColor }, ticks:{ color:textColor, font:{size:11}, callback:(v)=> v+'%' }, beginAtZero:true }
        }
      }
    });

    // pm.label para 'total' ya dice "total, equivalente en US$" -- si se le
    // antepone "...en el crédito agro total, {pm.label}" queda "...agro
    // total, total, equivalente..." (total repetido). Por eso ese modo no
    // repite el calificador de moneda; pesos/dólares sí lo agregan.
    const monedaSufijo = state.cur==='total' ? '' : (', '+pm.label);
    document.getElementById('participChartDesc').innerHTML = 'Participación de <b>'+act.nombre+'</b> en el crédito agro total'+monedaSufijo+'.';
  }

  // Mix de monedas en el tiempo: para cada trimestre de la ventana elegida,
  // qué porcentaje del saldo DE ESTA ACTIVIDAD (no del total agro -- eso ya
  // lo cubre renderParticipChart) está en pesos y qué porcentaje está en
  // dólares. Es la versión histórica de la tile "Mix por moneda" (que sigue
  // mostrando un único número, agregado sobre toda la ventana, igual que
  // antes) -- acá se ve la serie completa, trimestre a trimestre. No depende
  // de #curSeg (a diferencia del resto de la vista): mostrar "el mix entre
  // pesos y dólares" no tiene sentido fijado a una sola moneda, así que este
  // gráfico siempre muestra ambas series.
  //
  // % en pesos = pesos_ars / total_ars. % en dólares = (dolares_usd * tc) /
  // total_ars -- es decir, el dólar se lleva a su equivalente en pesos con
  // el tipo de cambio de ese mismo trimestre antes de sacar el porcentaje,
  // para que las dos series sumen ~100% (mismo criterio que la tile "Mix por
  // moneda" ya usaba, y que total_ars = pesos_ars + dolares_usd*tc en todo
  // el dataset -- verificado independientemente).
  function renderMixChart(act){
    const periodosVisible = PERIODOS.slice(state.rangeStart, state.rangeEnd+1);
    const labels = periodosVisible.map(p=>PLABEL[p]);
    const seriesVisible = act.series.slice(state.rangeStart, state.rangeEnd+1);
    const pesosPct = seriesVisible.map(s=>{
      if(!s || s.pesos_ars===null || s.pesos_ars===undefined || !s.total_ars) return null;
      return s.pesos_ars/s.total_ars*100;
    });
    const dolaresPct = seriesVisible.map(s=>{
      if(!s || s.dolares_usd===null || s.dolares_usd===undefined || s.tc===null || s.tc===undefined || !s.total_ars) return null;
      return (s.dolares_usd*s.tc)/s.total_ars*100;
    });

    const styles = getComputedStyle(document.documentElement);
    const accent = styles.getPropertyValue('--accent').trim();
    const gold = styles.getPropertyValue('--gold').trim();
    const textColor = styles.getPropertyValue('--text-muted').trim();
    const gridColor = styles.getPropertyValue('--border').trim();

    const ctx = document.getElementById('mixChart').getContext('2d');
    if(mixChart) mixChart.destroy();
    mixChart = new Chart(ctx, {
      type:'line',
      data:{ labels, datasets:[
        { label:'Pesos', data: pesosPct, borderColor: accent, backgroundColor: accent, tension:.25, pointRadius:2, spanGaps:false },
        { label:'Dólares', data: dolaresPct, borderColor: gold, backgroundColor: gold, tension:.25, pointRadius:2, spanGaps:false },
      ]},
      options:{
        responsive:true, maintainAspectRatio:false,
        plugins:{ legend:{display:false}, tooltip:{ callbacks:{ label:(c)=> c.dataset.label+': '+(c.raw!=null?fmtPct.format(c.raw)+'%':'sin dato') } } },
        scales:{
          x:{ grid:{display:false}, ticks:{ color:textColor, font:{size:11}, maxRotation:0, autoSkip:true } },
          y:{ grid:{ color:gridColor }, ticks:{ color:textColor, font:{size:11}, callback:(v)=> v+'%' }, beginAtZero:true, max:100 }
        }
      }
    });
    const legendEl = document.getElementById('mixChartLegend');
    legendEl.innerHTML =
      '<span class="toggle" data-idx="0"><i style="background:'+accent+'"></i>Pesos</span>'
      + '<span class="toggle" data-idx="1"><i style="background:'+gold+'"></i>Dólares</span>';
    legendEl.querySelectorAll('.toggle').forEach(function(el){
      el.onclick = function(){
        const idx = Number(el.dataset.idx);
        const visible = mixChart.isDatasetVisible(idx);
        mixChart.setDatasetVisibility(idx, !visible);
        mixChart.update();
        el.classList.toggle('off', visible);
      };
    });

    document.getElementById('mixChartDesc').innerHTML = 'Mix de pesos y dólares en el saldo de <b>'+act.nombre+'</b>.';
  }

  function renderTiles(act){
    const meta = currencyMeta(state.cur);
    const series = act.series;
    const valid = series.filter(s=>s && s[meta.field]!==null && s[meta.field]!==undefined);
    const last = valid[valid.length-1];

    // La tile de variación usa la ventana elegida en el slider de tiempo,
    // no siempre "desde el primer trimestre" -- así el slider también
    // cambia lo que dice esta tile, no solo los gráficos.
    const windowSeries = series.slice(state.rangeStart, state.rangeEnd+1)
      .filter(s=>s && s[meta.field]!==null && s[meta.field]!==undefined);
    const wFirst = windowSeries[0];
    const wLast = windowSeries[windowSeries.length-1];

    const wrap = document.getElementById('tiles');
    wrap.innerHTML='';

    const tileActual = document.createElement('div');
    tileActual.className='tile';
    tileActual.innerHTML = '<div class="label">Saldo · '+(last?PLABEL[last.periodo]:'—')+'</div>'
      + '<div class="value mono">'+(last?fmtMillones(last[meta.field], meta.prefix):'—')+'</div>'
      + '<div class="unit">'+meta.label+'</div>';
    wrap.appendChild(tileActual);

    const tileVar = document.createElement('div');
    tileVar.className='tile';
    let varHtml = '<div class="label">Variación del período</div>';
    if(wFirst && wLast && wFirst!==wLast && wFirst[meta.field]){
      const pct = ((wLast[meta.field]-wFirst[meta.field])/Math.abs(wFirst[meta.field]))*100;
      const good = pct>=0;
      varHtml += '<div class="value mono">'+(good?'+':'')+fmtPct.format(pct)+'%</div>'
        + '<span class="chip '+(good?'good':'bad')+'">'+(good?'▲ suba':'▼ baja')+' vs '+PLABEL[wFirst.periodo]+'</span>';
    } else {
      varHtml += '<div class="value mono">—</div><div class="unit">sin serie suficiente en la ventana elegida</div>';
    }
    tileVar.innerHTML = varHtml;
    wrap.appendChild(tileVar);

    // Mix por moneda de la ventana elegida en el slider: no es el mix de un
    // solo trimestre, sino el total en dólares (llevado a pesos) sobre el
    // total general de todos los trimestres visibles -- así un trimestre
    // grande pesa más que uno chico dentro del promedio, y el número
    // cambia solo si el saldo de esos trimestres realmente cambia de mix.
    const windowFull = series.slice(state.rangeStart, state.rangeEnd+1)
      .filter(s=> s && s.pesos_ars!=null && s.dolares_usd!=null && s.tc!=null && s.total_ars);
    const tileMezcla = document.createElement('div');
    tileMezcla.className='tile';
    if(windowFull.length){
      const sumUsdArs = windowFull.reduce((acc,s)=> acc + s.dolares_usd*s.tc, 0);
      const sumTotalArs = windowFull.reduce((acc,s)=> acc + s.total_ars, 0);
      const shareUsd = sumTotalArs ? (sumUsdArs/sumTotalArs*100) : null;
      const rangoLbl = windowFull.length>1 ? (PLABEL[windowFull[0].periodo]+' a '+PLABEL[windowFull[windowFull.length-1].periodo]) : PLABEL[windowFull[0].periodo];
      tileMezcla.innerHTML = '<div class="label">Mix por moneda</div>'
        + '<div class="value mono">'+(shareUsd!=null?fmtPct.format(shareUsd)+'%':'—')+'</div>'
        + '<div class="unit">del saldo está en dólares · '+rangoLbl+'</div>';
    } else {
      tileMezcla.innerHTML = '<div class="label">Mix por moneda</div><div class="value mono">—</div><div class="unit">sin desglose en la ventana elegida</div>';
    }
    wrap.appendChild(tileMezcla);

    // Participación de esta actividad dentro del crédito agro total (todas
    // las actividades combinadas, DATA.actividades.length -- no hardcodeado,
    // porque a partir de que se agregaron más actividades agro/agroindustriales
    // en Oct-2026 el total ya no son siempre "12"), en el trimestre del
    // extremo derecho de la ventana elegida -- mismo criterio de "período
    // actual" que el resto de las tarjetas y paneles. Usa el total nacional
    // de resumen_nacional, que está alineado 1 a 1 por índice con
    // PERIODOS/series.
    const tileParticip = document.createElement('div');
    tileParticip.className='tile';
    const perP = PERIODOS[state.rangeEnd];
    const sActP = act.series[state.rangeEnd];
    const rnP = RN[state.rangeEnd];
    if(sActP && sActP.total_ars!=null && rnP && rnP.total_ars_nacional){
      const share = sActP.total_ars/rnP.total_ars_nacional*100;
      tileParticip.innerHTML = '<div class="label">Participación en el crédito agro</div>'
        + '<div class="value mono">'+fmtPct.format(share)+'%</div>'
        + '<div class="unit">del total de las '+DATA.actividades.length+' actividades en '+PLABEL[perP]+'</div>';
    } else {
      tileParticip.innerHTML = '<div class="label">Participación en el crédito agro</div>'
        + '<div class="value mono">—</div><div class="unit">sin dato de saldo total en '+PLABEL[perP]+'</div>';
    }
    wrap.appendChild(tileParticip);

    // Saldo producto: saldo de crédito del trimestre ÷ precio de productor
    // del mismo trimestre = cantidad física equivalente (toneladas, litros,
    // kg o cajas, según la actividad -- ver build_saldo_producto_precios.py
    // para la fuente y el porqué de cada elección de precio). Usa el mismo
    // trimestre que la tarjeta de Participación (el extremo derecho del
    // slider, no "el último con dato"), para que ambas tarjetas "del
    // período actual" hablen siempre del mismo trimestre. Solo existe para
    // 14 de las 21 actividades (act.saldo_producto_disponible); para las
    // otras 7 (servicios, catch-alls sin precio propio, azúcar sin ningún
    // dato, y procesamiento de carnes excluido a pedido de Ciro) la tarjeta
    // directamente NO se muestra (pedido explícito de Ciro, Oct-2026: antes
    // se mostraba igual con el motivo de por qué no, pero prefirió que para
    // esas 7 actividades no aparezca ni rastro de saldo producto, ni acá ni
    // en el toggle de Evolución -- ver renderSaldosView).
    if(act.saldo_producto_disponible){
      const tileSaldoProducto = document.createElement('div');
      tileSaldoProducto.className='tile';
      // Sin ícono "ⓘ" acá (a diferencia de Tasa producto / las notas de
      // actividad): es una tarjeta entera, no un botón chico, así que no
      // hace falta un marcador aparte -- igual que "Pesos constantes" y el
      // toggle "Saldo producto" de Evolución, el cartel aparece al pasar
      // el mouse (o tocar, en mobile) por toda la tarjeta. Mismo mecanismo
      // .seg-tooltip/wireInfoTooltip de siempre (ver más abajo en este
      // archivo), solo que acá el "wrap" es la tarjeta en vez de un
      // .seg-item -- por eso position:relative/cursor:help van inline acá
      // y no en .tile (el resto de las tarjetas no son hoverables).
      tileSaldoProducto.style.position = 'relative';
      tileSaldoProducto.style.cursor = 'help';
      const spVal = sActP ? sActP.saldo_producto : null;
      const saldoProductoTooltipHtml = '<b>¿Qué es "Saldo producto"?</b>Convierte el saldo de crédito en la cantidad física equivalente del producto de esta actividad (toneladas, litros, kg o cajas, según corresponda), dividiendo el saldo por el precio de ese producto en el mismo trimestre.';
      if(spVal!=null){
        tileSaldoProducto.innerHTML = '<div class="label">Saldo producto · '+PLABEL[perP]+'</div>'
          + '<div class="value mono">'+fmtUnidadProducto(spVal, act.saldo_producto_unidad)+'</div>'
          + '<div class="unit">'+act.saldo_producto_fuente+'</div>'
          + '<div class="seg-tooltip tile-tooltip" role="tooltip"></div>';
      } else {
        tileSaldoProducto.innerHTML = '<div class="label">Saldo producto · '+PLABEL[perP]+'</div>'
          + '<div class="value mono">—</div>'
          + '<div class="unit">sin precio disponible en '+PLABEL[perP]+' (la serie de precios arranca en 2016)</div>'
          + '<div class="seg-tooltip tile-tooltip" role="tooltip"></div>';
      }
      wrap.appendChild(tileSaldoProducto);
      wireInfoTooltip(tileSaldoProducto, saldoProductoTooltipHtml);
    }

    // #tiles tiene 5 columnas en escritorio SOLO cuando la tarjeta de Saldo
    // producto está presente -- si no, vuelve a la grilla de 4 columnas de
    // siempre (ver ".tiles-5" en styles.css). Mobile no se ve afectado: sus
    // media queries ya fuerzan 2 columnas sin importar la cantidad de tiles.
    wrap.classList.toggle('tiles-5', act.saldo_producto_disponible);
  }

  // Evolución admite dos modos (ver toggle #evolModeSeg en el HTML):
  // "saldo" (el de siempre, en la moneda elegida en Panorama) y
  // "saldoproducto" (cantidad física equivalente, misma cuenta que la
  // tarjeta de Saldo producto, pero a lo largo del tiempo). Comparten
  // toda la lógica del gráfico de barras -- solo cambia de dónde sale
  // `values`, el prefijo/sufijo de los números y el texto de abajo.
  function renderChart(act){
    const isProducto = state.evolMode==='saldoproducto' && act.saldo_producto_disponible;

    let meta, values, unidadSufijo, descHtml;
    if(isProducto){
      let unidad = act.saldo_producto_unidad;
      values = act.series.slice(state.rangeStart, state.rangeEnd+1)
        .map(s => s && s.saldo_producto!=null ? s.saldo_producto : null);
      if(unidad==='kg'){ values = values.map(v=> v===null?null:v/1000); unidad='t'; }
      else if(unidad==='caja de 18kg'){ unidad='cajas de 18kg'; }
      meta = { prefix:'', label:'producto' };
      unidadSufijo = ' '+unidad;
      descHtml = 'Saldo producto de <b>'+act.nombre+'</b>, por trimestre ('+act.saldo_producto_fuente+').';
    } else {
      meta = currencyMeta(state.cur);
      values = act.series.slice(state.rangeStart, state.rangeEnd+1)
        .map(s => s && s[meta.field]!==undefined ? s[meta.field] : null);
      unidadSufijo = '';
      descHtml = 'Saldo <b>'+meta.label+'</b> de <b>'+act.nombre+'</b>, por trimestre.';
    }

    const periodosVisible = PERIODOS.slice(state.rangeStart, state.rangeEnd+1);
    const labels = periodosVisible.map(p=>PLABEL[p]);
    const lastIdx = values.reduce((acc,v,i)=> v!==null ? i : acc, -1);
    const maxAbs = values.reduce((m,v)=> v!==null ? Math.max(m, Math.abs(v)) : m, 0);
    const scale = pickScale(maxAbs);

    const styles = getComputedStyle(document.documentElement);
    const muted = styles.getPropertyValue('--bar-muted').trim();
    const hi = styles.getPropertyValue('--bar-highlight').trim();
    const textColor = styles.getPropertyValue('--text-muted').trim();
    const gridColor = styles.getPropertyValue('--border').trim();

    const bg = values.map((v,i)=> i===lastIdx ? hi : muted);
    const fmtTick = (v)=> (meta.prefix ? meta.prefix+' ' : '') + fmt1.format(v) + scale.suf + unidadSufijo;

    const ctx = document.getElementById('evolChart').getContext('2d');
    if(evolChart) evolChart.destroy();
    evolChart = new Chart(ctx, {
      type:'bar',
      data:{ labels, datasets:[{
        data: values.map(v=>v===null?0:v/scale.div),
        backgroundColor: bg,
        borderRadius: 5,
        maxBarThickness: 56,
      }]},
      options:{
        responsive:true, maintainAspectRatio:false,
        plugins:{ legend:{display:false},
          tooltip:{ callbacks:{ label:(c)=> fmtTick(c.raw) } }
        },
        scales:{
          x:{ grid:{display:false}, ticks:{ color:textColor, font:{size:11.5, weight:600} } },
          y:{ grid:{ color:gridColor }, ticks:{ color:textColor, font:{size:11}, callback:(v)=> fmtTick(v) }, beginAtZero:true }
        }
      }
    });

    document.getElementById('chartDesc').innerHTML = descHtml;
    document.getElementById('chartLegend').innerHTML =
      '<span><i style="background:'+muted+'"></i>trimestre anterior</span>'
      + '<span><i style="background:'+hi+'"></i>último dato</span>';
  }

  // Escala de color del mapa: blanco/gris muy claro (poco crédito) a un verde
  // casi negro (mucho crédito). Usa raíz cuadrada en vez de escala lineal
  // porque BS AS/Córdoba/Santa Fe/CABA concentran una porción enorme del
  // total -- con escala lineal el resto de las provincias se verían todas
  // casi blancas y no se distinguirían entre sí.
  function provColorScale(t){
    t = Math.max(0, Math.min(1, t));
    const lightness = 93 - t*85;   // 93% (casi blanco) -> 8% (casi negro)
    const saturation = 8 + t*30;   // un poco de verde institucional, más marcado cuanto más oscuro
    return 'hsl(150 '+saturation.toFixed(0)+'% '+lightness.toFixed(0)+'%)';
  }

  function renderProvinceTable(act){
    const meta = currencyMeta(state.cur);
    // El mapa/ranking siguen el extremo derecho de la ventana de tiempo del
    // slider -- igual criterio que el resto de la vista (ver renderDiffChart
    // en Resumen) -- en vez de mostrar siempre el último trimestre de toda
    // la serie.
    const idx = state.rangeEnd;
    const per = PERIODOS[idx];
    const entry = act.provincias_series && act.provincias_series[idx];
    const provs = (entry && entry[meta.provField]) || {};
    const entries = Object.entries(provs).filter(([,v])=> v!==null && v!==undefined);
    entries.sort((a,b)=> b[1]-a[1]);
    const total = entries.reduce((s,[,v])=>s+v,0);
    const max = entries.length ? entries[0][1] : 1;
    const sqrtMax = Math.sqrt(max || 1);

    // -------- Mapa --------
    const mapEl = document.getElementById('provMap');
    const valByProv = Object.fromEntries(entries);
    // Se reescribe en CADA render (no solo la primera vez) -- es lo que lee
    // el listener de "mouseenter" de abajo, para no quedar con los valores
    // de la actividad/moneda/trimestre con que se construyó el SVG la
    // primera vez (ver comentario junto a la declaración de
    // provMapLiveSaldos, más arriba).
    provMapLiveSaldos.valByProv = valByProv;
    provMapLiveSaldos.total = total;
    if(!mapEl.dataset.built){
      const svgParts = ['<svg viewBox="'+AR_MAP.viewBox+'" preserveAspectRatio="xMidYMid meet">'];
      Object.keys(AR_MAP.paths).forEach(function(name){
        svgParts.push('<path data-prov="'+name+'" d="'+AR_MAP.paths[name]+'" />');
      });
      svgParts.push('<circle data-prov="CABA" cx="'+AR_MAP.caba.x+'" cy="'+AR_MAP.caba.y+'" r="4.2" />');
      svgParts.push('</svg>');
      mapEl.innerHTML = svgParts.join('');
      mapEl.dataset.built = '1';
      mapEl.querySelectorAll('[data-prov]').forEach(function(el){
        el.addEventListener('mouseenter', function(evt){
          const name = el.dataset.prov;
          provPanelSaldos.setHover(name);
          const val = provMapLiveSaldos.valByProv[name];
          const pct = val!=null && provMapLiveSaldos.total ? val/provMapLiveSaldos.total*100 : null;
          const prefix = currencyMeta(state.cur).prefix;
          provPanelSaldos.showTooltip('<b>'+name+'</b><br>'+(val!=null ? fmtMillones(val, prefix)+(pct!=null?' · '+fmtPct.format(pct)+'% del total':'') : 'sin desglose disponible'), evt);
        });
        el.addEventListener('mousemove', provPanelSaldos.moveTooltip);
        el.addEventListener('mouseleave', function(){ provPanelSaldos.setHover(null); provPanelSaldos.hideTooltip(); });
      });
    }
    mapEl.querySelectorAll('[data-prov]').forEach(function(el){
      const name = el.dataset.prov;
      const val = valByProv[name];
      el.setAttribute('fill', val!=null ? provColorScale(Math.sqrt(val)/(sqrtMax||1)) : 'var(--bar-track)');
      el.classList.toggle('prov-nodata', val==null);
    });

    const legendEl = document.getElementById('provLegend');
    if(legendEl){
      legendEl.innerHTML = '<span class="provlegend-label">'+meta.prefix+' 0</span>'
        + '<span class="provlegend-bar"></span>'
        + '<span class="provlegend-label">'+(entries.length?fmtMillones(max, meta.prefix):'—')+'</span>';
    }

    // -------- Listado completo (24 jurisdicciones) --------
    const body = document.getElementById('provBody');
    body.innerHTML='';
    if(!entries.length){
      body.innerHTML = '<tr><td colspan="4" style="color:var(--text-faint); padding:16px 10px;">No hay desglose por provincia para '+PLABEL[per]+' en esta vista de moneda.</td></tr>';
    } else {
      entries.forEach(([name,val], i)=>{
        const tr = document.createElement('tr');
        tr.dataset.prov = name;
        const pct = total ? (val/total*100) : 0;
        const w = max ? (val/max*100) : 0;
        tr.innerHTML = '<td><span class="rank">'+(i+1)+'</span></td>'
          + '<td class="prov">'+name+'</td>'
          + '<td class="num mono">'+fmtMillones(val, meta.prefix)+'<div class="barcell"><i style="width:'+w.toFixed(1)+'%"></i></div></td>'
          + '<td class="num sharecol mono">'+fmtPct.format(pct)+'%</td>';
        tr.addEventListener('mouseenter', function(evt){
          provPanelSaldos.setHover(name);
          provPanelSaldos.showTooltip('<b>'+name+'</b><br>'+fmtMillones(val, meta.prefix)+' · '+fmtPct.format(pct)+'% del total', evt);
        });
        tr.addEventListener('mousemove', provPanelSaldos.moveTooltip);
        tr.addEventListener('mouseleave', function(){ provPanelSaldos.setHover(null); provPanelSaldos.hideTooltip(); });
        body.appendChild(tr);
      });
    }
    document.getElementById('provDesc').innerHTML = 'Saldo por provincia <b>'+meta.label+'</b> en <b>'+PLABEL[per]+'</b> (extremo de la ventana de tiempo elegida). Cuanto más oscura la provincia en el mapa, mayor su saldo.';
  }

  // Escala de color para el mapa de tasas: a diferencia del saldo (que usa
  // raíz cuadrada desde 0 porque unas pocas provincias concentran casi todo
  // el crédito), la tasa de interés no tiene esa concentración -- todas las
  // provincias tienen una tasa en un rango parecido. Por eso acá se normaliza
  // linealmente entre el mínimo y el máximo del conjunto visible, para que
  // el color aproveche todo el degradé en vez de apelotonarse en un extremo.
  function renderTasaProvinceMap(act){
    const cur = state.curTasaProv;
    const curLabel = cur==='dolares' ? 'en dólares' : 'en pesos';
    // Mismo criterio que el mapa de Saldos: sigue el extremo derecho de la
    // ventana de tiempo del slider, no siempre el último trimestre.
    const idx = state.rangeEnd;
    const per = PERIODOS[idx];
    const entry = act.tasas_provincias_series && act.tasas_provincias_series[idx];
    const provs = (entry && entry[cur]) || {};
    const entries = Object.entries(provs).filter(([,v])=> v!==null && v!==undefined);
    entries.sort((a,b)=> b[1]-a[1]);
    const max = entries.length ? entries[0][1] : 1;
    const min = entries.length ? entries[entries.length-1][1] : 0;
    const span = (max-min) || 1;
    const valByProv = Object.fromEntries(entries);
    // Igual que en renderProvinceTable (Saldos): se reescribe en CADA
    // render para que el listener de "mouseenter" (atado una sola vez, ver
    // dataset.built abajo) no quede leyendo los valores de la
    // actividad/moneda/trimestre con que se construyó el SVG la primera vez.
    provMapLiveTasas.valByProv = valByProv;

    // -------- Mapa --------
    const mapEl = document.getElementById('tasaProvMap');
    if(!mapEl.dataset.built){
      const svgParts = ['<svg viewBox="'+AR_MAP.viewBox+'" preserveAspectRatio="xMidYMid meet">'];
      Object.keys(AR_MAP.paths).forEach(function(name){
        svgParts.push('<path data-prov="'+name+'" d="'+AR_MAP.paths[name]+'" />');
      });
      svgParts.push('<circle data-prov="CABA" cx="'+AR_MAP.caba.x+'" cy="'+AR_MAP.caba.y+'" r="4.2" />');
      svgParts.push('</svg>');
      mapEl.innerHTML = svgParts.join('');
      mapEl.dataset.built = '1';
      mapEl.querySelectorAll('[data-prov]').forEach(function(el){
        el.addEventListener('mouseenter', function(evt){
          const name = el.dataset.prov;
          provPanelTasas.setHover(name);
          const val = provMapLiveTasas.valByProv[name];
          provPanelTasas.showTooltip('<b>'+name+'</b><br>'+(val!=null ? fmtPct.format(val)+'% TNA' : 'sin dato disponible'), evt);
        });
        el.addEventListener('mousemove', provPanelTasas.moveTooltip);
        el.addEventListener('mouseleave', function(){ provPanelTasas.setHover(null); provPanelTasas.hideTooltip(); });
      });
    }
    mapEl.querySelectorAll('[data-prov]').forEach(function(el){
      const name = el.dataset.prov;
      const val = valByProv[name];
      el.setAttribute('fill', val!=null ? provColorScale((val-min)/span) : 'var(--bar-track)');
      el.classList.toggle('prov-nodata', val==null);
    });

    const legendEl = document.getElementById('tasaProvLegend');
    if(legendEl){
      legendEl.innerHTML = '<span class="provlegend-label">'+(entries.length?fmtPct.format(min)+'%':'—')+'</span>'
        + '<span class="provlegend-bar"></span>'
        + '<span class="provlegend-label">'+(entries.length?fmtPct.format(max)+'%':'—')+'</span>';
    }

    // -------- Listado completo (24 jurisdicciones) --------
    const body = document.getElementById('tasaProvBody');
    body.innerHTML='';
    if(!entries.length){
      body.innerHTML = '<tr><td colspan="3" style="color:var(--text-faint); padding:16px 10px;">No hay tasa por provincia '+curLabel+' para '+PLABEL[per]+'.</td></tr>';
    } else {
      entries.forEach(([name,val], i)=>{
        const tr = document.createElement('tr');
        tr.dataset.prov = name;
        const w = span ? ((val-min)/span*100) : 0;
        tr.innerHTML = '<td><span class="rank">'+(i+1)+'</span></td>'
          + '<td class="prov">'+name+'</td>'
          + '<td class="num mono">'+fmtPct.format(val)+'%<div class="barcell"><i style="width:'+w.toFixed(1)+'%"></i></div></td>';
        tr.addEventListener('mouseenter', function(evt){
          provPanelTasas.setHover(name);
          provPanelTasas.showTooltip('<b>'+name+'</b><br>'+fmtPct.format(val)+'% TNA', evt);
        });
        tr.addEventListener('mousemove', provPanelTasas.moveTooltip);
        tr.addEventListener('mouseleave', function(){ provPanelTasas.setHover(null); provPanelTasas.hideTooltip(); });
        body.appendChild(tr);
      });
    }
    document.getElementById('tasaProvDesc').innerHTML = 'Tasa <b>'+curLabel+'</b> por provincia en <b>'+PLABEL[per]+'</b> (extremo de la ventana de tiempo elegida). Cuanto más oscura la provincia en el mapa, más alta su tasa.';
  }

  function renderSaldosView(){
    const act = getAct(state.actId);
    const noteEl = document.getElementById('partialNoteSaldos');
    const noteText = document.getElementById('partialNoteSaldosText');
    if(!act.saldos_total_completo){
      const lastLbl = act.ultimo_periodo ? PLABEL[act.ultimo_periodo] : '—';
      noteText.innerHTML = 'Esta actividad solo tiene saldo total reportado hasta <b>'+lastLbl+'</b>. No hay serie trimestral completa.';
      noteEl.style.display = 'flex';
    } else if(!act.saldos_moneda_completo){
      noteText.innerHTML = 'El saldo <b>total</b> está completo para los '+PERIODOS.length+' trimestres, pero esta actividad no tiene desglose por moneda (pesos/dólares) reportado.';
      noteEl.style.display = 'flex';
    } else {
      noteEl.style.display = 'none';
    }

    // "Pesos" y "Dólares" necesitan el desglose por moneda de la actividad
    // (saldos_moneda_completo). "Total" y "Pesos constantes" se arman solo
    // con el saldo total (saldos_total_completo, ya filtrado arriba antes
    // de llegar acá), así que esos dos quedan habilitados aunque la
    // actividad no tenga desglose por moneda.
    const segBtns = document.getElementById('curSeg').querySelectorAll('button');
    const necesitaDesglose = (c)=> c==='pesos' || c==='dolares';
    segBtns.forEach(b=>{
      b.disabled = !act.saldos_moneda_completo && necesitaDesglose(b.dataset.cur);
    });
    if(!act.saldos_moneda_completo && necesitaDesglose(state.cur)){
      state.cur = 'total';
      segBtns.forEach(b=>b.classList.toggle('active', b.dataset.cur==='total'));
    }

    // Toggle de Evolución ("Saldo" / "Saldo producto"): si la actividad no
    // tiene saldo producto, el toggle entero desaparece (pedido explícito
    // de Ciro, Oct-2026 -- antes el botón quedaba deshabilitado y visible;
    // ahora, para esas 7 actividades, no debe quedar ni rastro de "saldo
    // producto" en la vista) y el gráfico de Evolución vuelve a mostrarse
    // siempre en modo "Saldo" normal, sin ningún selector arriba -- igual
    // que se veía antes de que existiera saldo producto.
    const evolToolbar = document.querySelector('#saldos-evolucion .toolbar');
    if(!act.saldo_producto_disponible){
      if(evolToolbar) evolToolbar.style.display = 'none';
      state.evolMode = 'saldo';
    } else {
      if(evolToolbar) evolToolbar.style.display = '';
      const evolBtns = document.getElementById('evolModeSeg').querySelectorAll('button[data-evolmode]');
      evolBtns.forEach(b=>b.classList.toggle('active', b.dataset.evolmode===state.evolMode));
    }

    // Sección "Participación" (el peso histórico de la actividad dentro del
    // crédito agro total, en línea de tiempo): para "Total Agro" no tiene
    // sentido -- comparado contra sí mismo, sería siempre una línea plana
    // en 100%. Se oculta entera (sección + link de nav), mismo patrón que
    // el resto de las ocultaciones de esta vista (ver Saldo producto más
    // arriba). Para el resto de las actividades sigue igual que siempre.
    const seccionPart = document.getElementById('saldos-participacion');
    const navLinkPart = document.querySelector('#saldosNav a[href="#saldos-participacion"]');
    if(act.esTotalAgro){
      if(seccionPart) seccionPart.style.display = 'none';
      if(navLinkPart) navLinkPart.style.display = 'none';
      if(participChart){ participChart.destroy(); participChart = null; }
    } else {
      if(seccionPart) seccionPart.style.display = '';
      if(navLinkPart) navLinkPart.style.display = '';
      renderParticipChart(act);
    }

    // Sección "Composición" (de qué actividades se arma el total del agro):
    // igual que Sectores, SOLO tiene sentido para "Total Agro" -- para una
    // actividad puntual no hay nada que discriminar dentro de sí misma.
    // Pedido explícito de Ciro, Oct-2026: réplica del panel de Sectores, un
    // escalón "adentro" de él (va justo antes en el nav).
    const seccionComposicion = document.getElementById('saldos-composicion');
    const navLinkComposicion = document.querySelector('#saldosNav a[href="#saldos-composicion"]');
    if(act.esTotalAgro){
      if(seccionComposicion) seccionComposicion.style.display = '';
      if(navLinkComposicion) navLinkComposicion.style.display = '';
      renderComposicionChart();
    } else {
      if(seccionComposicion) seccionComposicion.style.display = 'none';
      if(navLinkComposicion) navLinkComposicion.style.display = 'none';
      if(composicionChart){ composicionChart.destroy(); composicionChart = null; }
    }

    // Sección "Sectores" (¿qué lugar ocupa el agro en la economía?, torta
    // comparando el agro contra el resto de los sectores): al revés que
    // Participación, esta SOLO tiene sentido para "Total Agro" -- para una
    // actividad puntual no hay forma de ubicarla dentro de la composición
    // sectorial completa de la economía. Vivía en la extinta pestaña
    // "Resumen"; se mudó acá (pedido explícito de Ciro, Oct-2026) porque es
    // el único gráfico de esa pestaña que no es tema tasas.
    const seccionSectores = document.getElementById('saldos-sectores');
    const navLinkSectores = document.querySelector('#saldosNav a[href="#saldos-sectores"]');
    if(act.esTotalAgro){
      if(seccionSectores) seccionSectores.style.display = '';
      if(navLinkSectores) navLinkSectores.style.display = '';
      renderSectoresChart();
    } else {
      if(seccionSectores) seccionSectores.style.display = 'none';
      if(navLinkSectores) navLinkSectores.style.display = 'none';
      if(sectoresChart){ sectoresChart.destroy(); sectoresChart = null; }
    }

    // Sección "Internacional" (comparación Crédito agro / PBI contra otros
    // 5 países): mismo criterio que Composición/Sectores -- solo tiene
    // sentido para "Total Agro", nunca para una actividad puntual, porque
    // los otros países no están desglosados por actividad, solo el total
    // agro de cada uno. Pedido explícito de Ciro, Nov-2026.
    const seccionIntl = document.getElementById('saldos-internacional');
    const navLinkIntl = document.querySelector('#saldosNav a[href="#saldos-internacional"]');
    if(act.esTotalAgro){
      if(seccionIntl) seccionIntl.style.display = '';
      if(navLinkIntl) navLinkIntl.style.display = '';
      renderInternacionalChart();
    } else {
      if(seccionIntl) seccionIntl.style.display = 'none';
      if(navLinkIntl) navLinkIntl.style.display = 'none';
      if(intlChart){ intlChart.destroy(); intlChart = null; }
    }

    renderTiles(act);
    renderChart(act);
    renderMixChart(act);
    renderProvinceTable(act);
  }

  // Tasa real = tasa nominal deflactada por la inflación de una ventana
  // centrada de 12 meses (6 antes + 6 después de cada trimestre), con
  // fórmula de Fisher: (1+nominal)/(1+inflación) - 1. RN[i].inflacion_12m_centrada
  // viene de build_data.py (data/ipc_mensual.csv: INDEC real + proyección REM
  // para los meses que todavía no están publicados). Solo aplica a la vista
  // de Tasas en pesos -- la tasa ponderada de Resumen sigue siendo siempre
  // nominal (así lo pidió el usuario explícitamente).
  function tasaRealFisher(nominalPct, inflacionPct){
    if(nominalPct==null || inflacionPct==null) return null;
    return ((1 + nominalPct/100) / (1 + inflacionPct/100) - 1) * 100;
  }

  function renderTasaPesosChart(act){
    const periodosVisible = PERIODOS.slice(state.rangeStart, state.rangeEnd+1);
    const labels = periodosVisible.map(p=>PLABEL[p]);
    const tasasVisible = act.tasas.slice(state.rangeStart, state.rangeEnd+1);
    const rnVisible = RN.slice(state.rangeStart, state.rangeEnd+1);
    const isReal = state.tasaPesosMode === 'real';

    const pesos = tasasVisible.map((t, i)=>{
      if(!isReal) return t.pesos;
      const r = rnVisible[i];
      return tasaRealFisher(t.pesos, r && r.inflacion_12m_centrada);
    });

    const styles = getComputedStyle(document.documentElement);
    const accent = styles.getPropertyValue('--accent').trim();
    const textColor = styles.getPropertyValue('--text-muted').trim();
    const gridColor = styles.getPropertyValue('--border').trim();

    const ctx = document.getElementById('tasaPesosChart').getContext('2d');
    if(tasaPesosChart) tasaPesosChart.destroy();
    tasaPesosChart = new Chart(ctx, {
      type:'bar',
      data:{ labels, datasets:[
        { label: isReal ? 'Pesos (real)' : 'Pesos', data: pesos, backgroundColor: accent, borderRadius:5, maxBarThickness:34 },
      ]},
      options:{
        responsive:true, maintainAspectRatio:false,
        plugins:{ legend:{display:false}, tooltip:{ callbacks:{ label:(c)=> c.dataset.label+': '+fmtPct.format(c.raw)+'%' } } },
        scales:{
          x:{ grid:{display:false}, ticks:{ color:textColor, font:{size:11.5, weight:600} } },
          y:{ grid:{ color:gridColor }, ticks:{ color:textColor, font:{size:11}, callback:(v)=> v+'%' }, beginAtZero: !isReal }
        }
      }
    });

    let desc = isReal
      ? 'Tasa real: la nominal ajustada por inflación (fórmula de Fisher), con ventana de 12 meses centrada en cada trimestre.'
      : 'Tasa nominal anual en pesos, por trimestre.';
    const conProyeccion = isReal && rnVisible.some(r=> r && r.inflacion_meses_proyectados > 0);
    if(conProyeccion){
      desc += ' Los últimos trimestres toman parte de esa ventana de la proyección REM (INDEC aún no publicó esos meses).';
    }
    document.getElementById('tasaPesosDesc').innerHTML = desc;
  }

  function renderTasaDolaresChart(act){
    const periodosVisible = PERIODOS.slice(state.rangeStart, state.rangeEnd+1);
    const labels = periodosVisible.map(p=>PLABEL[p]);
    const tasasVisible = act.tasas.slice(state.rangeStart, state.rangeEnd+1);
    const dolares = tasasVisible.map(t=>t.dolares);

    const styles = getComputedStyle(document.documentElement);
    const gold = styles.getPropertyValue('--gold').trim();
    const textColor = styles.getPropertyValue('--text-muted').trim();
    const gridColor = styles.getPropertyValue('--border').trim();

    const ctx = document.getElementById('tasaDolaresChart').getContext('2d');
    if(tasaDolaresChart) tasaDolaresChart.destroy();
    tasaDolaresChart = new Chart(ctx, {
      type:'bar',
      data:{ labels, datasets:[
        { label:'Dólares', data: dolares, backgroundColor: gold, borderRadius:5, maxBarThickness:34 },
      ]},
      options:{
        responsive:true, maintainAspectRatio:false,
        plugins:{ legend:{display:false}, tooltip:{ callbacks:{ label:(c)=> c.dataset.label+': '+fmtPct.format(c.raw)+'%' } } },
        scales:{
          x:{ grid:{display:false}, ticks:{ color:textColor, font:{size:11.5, weight:600} } },
          y:{ grid:{ color:gridColor }, ticks:{ color:textColor, font:{size:11}, callback:(v)=> v+'%' }, beginAtZero:true }
        }
      }
    });
  }

  // Gráfico de "Tasa producto": UNA sola línea por trimestre con el
  // resultado ya neteado -- tasa de financiamiento nominal (en la moneda
  // que corresponde según el precio de esta actividad) MENOS la variación
  // interanual del precio de su propio producto. Mismo cálculo que ya
  // usaba la tarjeta de Panorama (renderTasaTiles): positivo = creció más
  // la tasa (rojo), negativo = creció más el precio del producto (verde).
  // Antes acá se mostraban las dos series por separado en barras; Ciro
  // pidió mostrar directamente el resultado final como línea (Oct-2026).
  function renderTasaProductoChart(act){
    const periodosVisible = PERIODOS.slice(state.rangeStart, state.rangeEnd+1);
    const labels = periodosVisible.map(p=>PLABEL[p]);
    const tasasVisible = act.tasas.slice(state.rangeStart, state.rangeEnd+1);
    const monedaLbl = act.saldo_producto_moneda==='usd' ? 'dólares' : 'pesos';
    const tasaProducto = tasasVisible.map(t=>{
      const nominal = act.saldo_producto_moneda==='usd' ? t.dolares : t.pesos;
      const variacion = t.variacion_producto;
      return (nominal!=null && variacion!=null) ? nominal - variacion : null;
    });

    const styles = getComputedStyle(document.documentElement);
    const textColor = styles.getPropertyValue('--text-muted').trim();
    const gridColor = styles.getPropertyValue('--border').trim();
    const badColor = styles.getPropertyValue('--bad-text').trim();
    const goodColor = styles.getPropertyValue('--good-text').trim();
    const colorFor = (v)=> v==null ? textColor : (v>=0 ? badColor : goodColor);

    const ctx = document.getElementById('tasaProductoChart').getContext('2d');
    if(tasaProductoChart) tasaProductoChart.destroy();
    tasaProductoChart = new Chart(ctx, {
      type:'line',
      data:{ labels, datasets:[
        { label:'Tasa producto', data: tasaProducto,
          borderWidth:2.5, pointRadius:3.5, pointHoverRadius:6, tension:0, spanGaps:false,
          pointBackgroundColor: tasaProducto.map(colorFor),
          pointBorderColor: tasaProducto.map(colorFor),
          segment:{ borderColor: (c)=> colorFor(((c.p0.parsed.y||0)+(c.p1.parsed.y||0))/2) },
          borderColor: badColor,
        },
      ]},
      options:{
        responsive:true, maintainAspectRatio:false,
        plugins:{ legend:{display:false},
          tooltip:{ callbacks:{ label:(c)=> c.raw!=null ? ((c.raw>=0?'+':'')+fmt1.format(c.raw)+' pp') : 'sin dato' } } },
        scales:{
          x:{ grid:{display:false}, ticks:{ color:textColor, font:{size:11.5, weight:600} } },
          y:{ grid:{ color:(c)=> c.tick.value===0 ? textColor : gridColor }, ticks:{ color:textColor, font:{size:11}, callback:(v)=> (v>0?'+':'')+v+' pp' } }
        }
      }
    });

    document.getElementById('tasaProductoLegend').innerHTML =
      '<span><i style="background:'+badColor+'"></i>Creció más la tasa ('+monedaLbl+')</span>'
      + '<span><i style="background:'+goodColor+'"></i>Creció más el precio del producto</span>';
  }

  // Tarjetas de la pestaña Tasas: muestran la tasa nacional (de la actividad
  // elegida) en el trimestre del extremo derecho de la ventana del slider, en
  // pesos y en dólares, más la variación contra el trimestre INMEDIATO
  // anterior (no contra el inicio de la ventana -- a diferencia de la tarjeta
  // "Variación del período" de Saldos, acá interesa el movimiento trimestre a
  // trimestre). Una tasa que sube se marca en rojo (crédito más caro) y una
  // que baja en verde, igual criterio que la tarjeta "Costo efectivo" de
  // Resumen.
  function renderTasaTiles(act){
    const idx = state.rangeEnd;
    const per = PERIODOS[idx];
    const cur = act.tasas[idx];
    const prev = idx>0 ? act.tasas[idx-1] : null;

    const wrap = document.getElementById('tasaTiles');
    wrap.innerHTML = '';

    const tPesos = document.createElement('div'); tPesos.className='tile';
    tPesos.innerHTML = '<div class="label">Tasa nacional · pesos</div>'
      + '<div class="value mono">'+(cur && cur.pesos!=null ? fmtPct.format(cur.pesos)+'%' : '—')+'</div>'
      + '<div class="unit">'+PLABEL[per]+', TNA</div>';
    wrap.appendChild(tPesos);

    const tDolares = document.createElement('div'); tDolares.className='tile';
    tDolares.innerHTML = '<div class="label">Tasa nacional · dólares</div>'
      + '<div class="value mono">'+(cur && cur.dolares!=null ? fmtPct.format(cur.dolares)+'%' : '—')+'</div>'
      + '<div class="unit">'+PLABEL[per]+', TNA</div>';
    wrap.appendChild(tDolares);

    function varTile(label, curVal, prevVal, prevPeriodo){
      const tile = document.createElement('div'); tile.className='tile';
      let html = '<div class="label">'+label+'</div>';
      if(curVal!=null && prevVal!=null){
        const diff = curVal-prevVal;
        const subio = diff>0, bajo = diff<0;
        const arrow = subio ? '▲ subió' : (bajo ? '▼ bajó' : '= sin cambios');
        html += '<div class="value mono">'+(diff>=0?'+':'')+fmt1.format(diff)+' pp</div>'
          + '<span class="chip '+(subio?'bad':'good')+'">'+arrow+' vs '+PLABEL[prevPeriodo]+'</span>';
      } else {
        html += '<div class="value mono">—</div><div class="unit">sin dato del trimestre anterior</div>';
      }
      tile.innerHTML = html;
      return tile;
    }
    wrap.appendChild(varTile('Variación tasa · pesos', cur && cur.pesos, prev && prev.pesos, prev && prev.periodo));
    wrap.appendChild(varTile('Variación tasa · dólares', cur && cur.dolares, prev && prev.dolares, prev && prev.periodo));

    // Tasa producto: compara la tasa de financiamiento nominal de esta
    // actividad (en la moneda que corresponde según su propio precio de
    // producto -- act.saldo_producto_moneda, ver build_saldo_producto_precios.py)
    // contra la variación INTERANUAL del precio de ese producto, para ver
    // cuál de las dos creció más en el último año. Serie nueva e
    // independiente de "Tasa real" (que sigue siendo nominal deflactada
    // por IPC, sin cambios) -- pedido explícito de Ciro de no reemplazarla.
    // Mismo criterio de "trimestre actual" que el resto de las tarjetas:
    // el extremo derecho del slider. Solo existe para las 14 actividades
    // con saldo producto; para las otras 7 la tarjeta directamente NO se
    // muestra (pedido explícito de Ciro, Oct-2026 -- ver mismo comentario
    // en renderTiles()/Saldos, idéntico criterio acá).
    if(act.saldo_producto_disponible){
      const tileTasaProducto = document.createElement('div'); tileTasaProducto.className='tile';
      const monedaLbl = act.saldo_producto_moneda==='usd' ? 'dólares' : 'pesos';
      const nominal = cur ? (act.saldo_producto_moneda==='usd' ? cur.dolares : cur.pesos) : null;
      const variacion = cur ? cur.variacion_producto : null;
      if(nominal!=null && variacion!=null){
        const diff = nominal - variacion;
        const subioTasa = diff>0, subioPrecio = diff<0;
        const arrow = subioTasa ? '▲ subió más la tasa' : (subioPrecio ? '▲ subió más el precio' : '= subieron igual');
        tileTasaProducto.innerHTML = '<div class="label">Tasa producto · '+PLABEL[per]+'</div>'
          + '<div class="value mono">'+(diff>=0?'+':'')+fmt1.format(diff)+' pp</div>'
          + '<span class="chip '+(subioTasa?'bad':'good')+'">'+arrow+'</span>'
          + '<div class="unit">tasa en '+monedaLbl+' vs. variación interanual del precio</div>';
      } else {
        tileTasaProducto.innerHTML = '<div class="label">Tasa producto · '+PLABEL[per]+'</div>'
          + '<div class="value mono">—</div>'
          + '<div class="unit">sin variación interanual de precio disponible en '+PLABEL[per]+' (la serie de precios arranca en 2016)</div>';
      }
      wrap.appendChild(tileTasaProducto);
    }

    // Mismo criterio de grilla 4/5 columnas que #tiles en Saldos (ver
    // styles.css, ".tiles-5").
    wrap.classList.toggle('tiles-5', act.saldo_producto_disponible);
  }

  // Links de nav + secciones de cada "modo" de la pestaña Tasas: el set de
  // una actividad real (planilla de tasas propia) y el de "Total Agro"
  // (contenido que antes vivía en la extinta pestaña "Resumen" -- panorama
  // nacional, evolución de la tasa ponderada, diferencial por actividad y
  // costo efectivo pesos vs. dólares). Comparten la misma #tasasNav y el
  // mismo #view-tasas; se esconde un set entero y se muestra el otro, mismo
  // patrón de "ocultación completa" que el resto del sitio (ver Tasa
  // producto/Participación/Sectores).
  const TASAS_IDS_REALES = ['tasas-panorama','tasas-pesos','tasas-dolares','tasas-provincias'];
  const TASAS_IDS_TOTALAGRO = ['resumen-panorama','resumen-tasas','resumen-diferencial','resumen-costo'];
  function toggleTasasGroup(ids, show){
    ids.forEach(id=>{
      const el = document.getElementById(id); if(el) el.style.display = show ? '' : 'none';
      const link = document.querySelector('#tasasNav a[href="#'+id+'"]'); if(link) link.style.display = show ? '' : 'none';
    });
  }
  function setTasasNavActive(href){
    document.querySelectorAll('#tasasNav a').forEach(a=> a.classList.toggle('active', a.getAttribute('href')===href));
  }

  function renderTasasView(){
    const act = getAct(state.actId);
    moveRangeSlider();

    if(act.esTotalAgro){
      toggleTasasGroup(TASAS_IDS_REALES, false);
      const seccionTP = document.getElementById('tasas-producto');
      const navLinkTP = document.querySelector('#tasasNav a[href="#tasas-producto"]');
      if(seccionTP) seccionTP.style.display = 'none';
      if(navLinkTP) navLinkTP.style.display = 'none';
      [tasaPesosChart, tasaDolaresChart, tasaProductoChart].forEach(c=>{ if(c) c.destroy(); });
      tasaPesosChart = tasaDolaresChart = tasaProductoChart = null;

      toggleTasasGroup(TASAS_IDS_TOTALAGRO, true);
      setTasasNavActive('#resumen-panorama');

      renderResumenTiles();
      renderResumenTasaChart();
      renderDiffChart();
      renderCostoChart();
      return;
    }

    toggleTasasGroup(TASAS_IDS_TOTALAGRO, false);
    if(resumenTasaChart){ resumenTasaChart.destroy(); resumenTasaChart = null; }
    if(diffChart){ diffChart.destroy(); diffChart = null; }
    if(costoChart){ costoChart.destroy(); costoChart = null; }
    toggleTasasGroup(TASAS_IDS_REALES, true);
    setTasasNavActive('#tasas-panorama');

    // Si a la actividad le faltan trimestres sueltos de tasa (pesos y/o
    // dólares) -- act.tasas_completo===false --, esos huecos simplemente
    // quedan como huecos en las líneas de los gráficos, sin cartel de aviso
    // (pedido explícito de Ciro, Oct-2026: se sacó el cartel de "faltan
    // trimestres" en Tasas, mismo criterio ya aplicado antes a Tasa
    // producto).

    // Sección "Tasa producto" entera (título, texto, gráfico y su propio
    // ítem en el menú de navegación de la pestaña): si la actividad no
    // tiene saldo producto, no aparece NADA de esto -- ni la tarjeta (ver
    // renderTasaTiles), ni esta sección, ni su link de navegación (pedido
    // explícito de Ciro, Oct-2026). Para las 14 actividades que sí tienen
    // tasa producto, los trimestres sin variación interanual de precio
    // (ej.: 2016, antes de que arranque la serie de precios) simplemente
    // quedan como huecos en la línea del gráfico -- sin cartel de aviso
    // (pedido explícito de Ciro, Oct-2026: se sacó el cartel de "faltan
    // trimestres").
    const seccionTP = document.getElementById('tasas-producto');
    const navLinkTP = document.querySelector('#tasasNav a[href="#tasas-producto"]');
    if(!act.saldo_producto_disponible){
      if(seccionTP) seccionTP.style.display = 'none';
      if(navLinkTP) navLinkTP.style.display = 'none';
      if(tasaProductoChart){ tasaProductoChart.destroy(); tasaProductoChart = null; }
    } else {
      if(seccionTP) seccionTP.style.display = '';
      if(navLinkTP) navLinkTP.style.display = '';
      renderTasaProductoChart(act);
    }

    renderTasaTiles(act);
    renderTasaPesosChart(act);
    renderTasaDolaresChart(act);
    renderTasaProvinceMap(act);
  }

  // ---------- Resumen nacional: tasa ponderada, diferencial, pesos vs. dólares ----------
  let resumenTasaChart, diffChart, costoChart;
  const RN = DATA.resumen_nacional || [];

  // ---------- Composición del crédito total de la economía, por sector ----------
  // DATA.resumen_sectores trae 9 sub-categorías por trimestre (ver
  // build_resumen_sectores en build_data.py), pero para que la torta se lea
  // de un vistazo se agrupan acá en 7: las 3 porciones más chicas y menos
  // intuitivas para público general (resto de producción primaria --pesca y
  // minería--, electricidad/gas/agua, y "no identificada") se suman en
  // "Otros". Nunca se tocan los números en sí, solo cómo se presentan.
  const RS = DATA.resumen_sectores || [];
  // Orden del anillo de la torta = el mismo que se validó contra confusión
  // por daltonismo (ver --sector-* en styles.css, incluye el par que cierra
  // el anillo) -- no reordenar sin volver a correr el validador de la
  // skill de dataviz. "otros" (gris, --text-faint) no es parte de ese
  // chequeo por matiz: al ser un gris sin saturación se distingue de
  // cualquier color por desaturación, no por tono.
  const SECTOR_ORDER = ['agro', 'construccion', 'personas_fisicas', 'servicios', 'industria_no_agro', 'comercio', 'otros'];
  const SECTOR_DISPLAY_LABELS = {
    agro: 'Agro', construccion: 'Construcción', personas_fisicas: 'Personas físicas',
    servicios: 'Servicios', industria_no_agro: 'Industria', comercio: 'Comercio', otros: 'Otros',
  };
  const SECTOR_CSS_VAR = {
    agro: '--sector-agro', construccion: '--sector-construccion', personas_fisicas: '--sector-personas',
    servicios: '--sector-servicios', industria_no_agro: '--sector-industria', comercio: '--sector-comercio',
    otros: '--sector-otros',
  };
  function sectorColor(key){
    return getComputedStyle(document.documentElement).getPropertyValue(SECTOR_CSS_VAR[key]).trim();
  }
  // Mismas 4 vistas de moneda que ya existen por actividad en Saldos (ver
  // currencyMeta más arriba), aplicadas acá a cada sector -- mismos nombres
  // de campo, calculados en build_resumen_sectores() con la misma lógica
  // (pesos_ars/dolares_usd/total_usd/total_ars_constante). La única
  // diferencia es la vista por default: acá arranca en "Pesos corrientes"
  // (total_ars, pesos+dólares del sector en pesos de hoy), no en
  // "Pesos ($)" como en Saldos -- ver nota en build_resumen_sectores()
  // sobre por qué total_ars (no pesos_ars) es la vista base de este panel.
  function sectorCurrencyMeta(cur){
    if(cur==='constante') return {prefix:'$', field:'total_ars_constante',
      label:'a precios constantes de '+PLABEL[PERIODOS[PERIODOS.length-1]]};
    if(cur==='dolares') return {prefix:'US$', field:'dolares_usd', label:'en dólares'};
    if(cur==='total') return {prefix:'US$', field:'total_usd', label:'total, equivalente en US$'};
    return {prefix:'$', field:'total_ars', label:'en pesos corrientes'};
  }
  function groupSectores(raw, field){
    const g = (k)=> raw[k] ? raw[k][field] : null;
    return {
      agro: g('agro'), construccion: g('construccion'), personas_fisicas: g('personas_fisicas'),
      servicios: g('servicios'), industria_no_agro: g('industria_no_agro'), comercio: g('comercio'),
      otros: (g('primaria_no_agro')||0) + (g('electricidad_gas_agua')||0) + (g('no_identificada')||0),
    };
  }

  let sectoresChart;
  const sectoresSlider = document.getElementById('sectoresPeriodoSlider');
  const sectoresFill = document.getElementById('sectoresPeriodoFill');
  const sectoresPeriodoLabel = document.getElementById('sectoresPeriodoLabel');
  if(sectoresSlider && RS.length){
    sectoresSlider.max = String(PERIODOS.length - 1);
    sectoresSlider.value = String(state.sectorPeriodoIdx);
    sectoresSlider.addEventListener('input', ()=>{
      state.sectorPeriodoIdx = Number(sectoresSlider.value);
      renderSectoresChart();
    });
  }
  function updateSectoresSliderUI(){
    const lastIdx = PERIODOS.length - 1;
    const pct = lastIdx ? (state.sectorPeriodoIdx / lastIdx * 100) : 100;
    if(sectoresFill){ sectoresFill.style.left = '0%'; sectoresFill.style.right = (100 - pct) + '%'; }
    if(sectoresPeriodoLabel) sectoresPeriodoLabel.textContent = PLABEL[PERIODOS[state.sectorPeriodoIdx]];
  }

  function renderSectoresChart(){
    const legendEl = document.getElementById('sectoresLegend');
    const bodyEl = document.getElementById('sectoresBody');
    if(!document.getElementById('sectoresChart')) return;

    updateSectoresSliderUI();

    const entry = RS[state.sectorPeriodoIdx];
    if(!entry){
      if(sectoresChart){ sectoresChart.destroy(); sectoresChart = null; }
      if(legendEl) legendEl.innerHTML = '';
      if(bodyEl) bodyEl.innerHTML = '<tr><td colspan="4">Sin datos de composición sectorial para este trimestre.</td></tr>';
      return;
    }

    const meta = sectorCurrencyMeta(state.curSectores);
    const grouped = groupSectores(entry.sectores, meta.field);
    const total = SECTOR_ORDER.reduce((s,k)=> s + (grouped[k]||0), 0);
    const rowsSorted = SECTOR_ORDER.slice().sort((a,b)=> grouped[b] - grouped[a]);

    const ctx = document.getElementById('sectoresChart').getContext('2d');
    if(sectoresChart) sectoresChart.destroy();
    const surfaceColor = getComputedStyle(document.documentElement).getPropertyValue('--surface').trim();
    sectoresChart = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: SECTOR_ORDER.map(k=>SECTOR_DISPLAY_LABELS[k]),
        datasets: [{
          data: SECTOR_ORDER.map(k=>grouped[k]),
          backgroundColor: SECTOR_ORDER.map(k=>sectorColor(k)),
          borderColor: surfaceColor, borderWidth: 2,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (c)=>{
            const v = c.raw; const pct = total ? (v/total*100) : 0;
            return c.label + ': ' + fmtMillones(v, meta.prefix) + ' (' + fmtPct.format(pct) + '%)';
          } } },
        },
      },
    });

    if(legendEl){
      legendEl.innerHTML = SECTOR_ORDER.map(k=>
        '<span><i style="background:'+sectorColor(k)+'"></i>'+SECTOR_DISPLAY_LABELS[k]+'</span>'
      ).join('');
    }
    if(bodyEl){
      bodyEl.innerHTML = rowsSorted.map(k=>{
        const v = grouped[k]; const pct = total ? (v/total*100) : 0;
        return '<tr><td><i style="display:inline-block;width:11px;height:11px;border-radius:3px;background:'+sectorColor(k)+'"></i></td>'
          + '<td>'+SECTOR_DISPLAY_LABELS[k]+'</td>'
          + '<td class="num mono">'+fmtMillones(v, meta.prefix)+'</td>'
          + '<td class="num mono">'+fmtPct.format(pct)+'%</td></tr>';
      }).join('');
    }
  }

  // ---------- Composición del crédito agro, por actividad (Total Agro / Saldos) ----------
  // Réplica directa del panel "Sectores" de arriba, pero discriminando las 21
  // actividades del agro entre sí en vez de comparar agro contra el resto de
  // la economía (pedido explícito de Ciro, Oct-2026: "antes del actual
  // gráfico de tortas... repliquemos, pero con el objetivo de mostrar la
  // composición de las 21 actividades"). Mismos controles (torta + tabla +
  // selector de moneda + slider de trimestre), mismo criterio de agrupar lo
  // chico en "Otras" para que la lista lateral no tenga 21 filas.
  //
  // Qué 6 actividades son "las nombradas" es FIJO (no se recalcula según el
  // trimestre o la moneda elegidos): se decide UNA sola vez acá, por volumen
  // total (US$ equivalente) en el último trimestre de la serie, y de ahí en
  // más esas 6 mantienen siempre el mismo color y lugar en la leyenda. Si en
  // vez de esto el "top 6" se recalculara en cada render, una actividad
  // podría cambiar de color (o directamente aparecer/desaparecer de la
  // leyenda) solo por mover el slider a otro trimestre o cambiar de moneda,
  // lo cual rompe la regla básica de color categórico: el color identifica
  // a la actividad, no a su posición en el ranking de ese momento (ver
  // skill de dataviz, "color follows the entity, never its rank"). El resto
  // de las actividades -- sean grandes o chicas ESE trimestre puntual -- cae
  // siempre en "Otras".
  const COMPOSICION_TOP_IDS = (function(){
    const lastIdx = PERIODOS.length - 1;
    return DATA.actividades.slice()
      .sort((a,b)=>{
        const va = a.series[lastIdx] ? a.series[lastIdx].total_usd : null;
        const vb = b.series[lastIdx] ? b.series[lastIdx].total_usd : null;
        return (vb||0) - (va||0);
      })
      .slice(0,6)
      .map(a=>a.id);
  })();
  // Mismos 6 colores ya validados para el anillo de "Sectores" (ver
  // SECTOR_CSS_VAR más arriba) -- misma paleta, mismo chequeo de daltonismo,
  // sin necesidad de validar una nueva. "Otras" usa el mismo gris que
  // "Otros" en Sectores (--sector-otros).
  const COMPOSICION_COLORS = ['--sector-industria','--sector-comercio','--sector-agro','--sector-construccion','--sector-personas','--sector-servicios'];
  function composicionColorFor(actId){
    const idx = COMPOSICION_TOP_IDS.indexOf(actId);
    const varName = idx>=0 ? COMPOSICION_COLORS[idx] : '--sector-otros';
    return getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  }

  let composicionChart;
  let intlChart;
  const composicionSlider = document.getElementById('composicionPeriodoSlider');
  const composicionFill = document.getElementById('composicionPeriodoFill');
  const composicionPeriodoLabel = document.getElementById('composicionPeriodoLabel');
  if(composicionSlider){
    composicionSlider.max = String(PERIODOS.length - 1);
    composicionSlider.value = String(state.composicionPeriodoIdx);
    composicionSlider.addEventListener('input', ()=>{
      state.composicionPeriodoIdx = Number(composicionSlider.value);
      renderComposicionChart();
    });
  }
  function updateComposicionSliderUI(){
    const lastIdx = PERIODOS.length - 1;
    const pct = lastIdx ? (state.composicionPeriodoIdx / lastIdx * 100) : 100;
    if(composicionFill){ composicionFill.style.left = '0%'; composicionFill.style.right = (100 - pct) + '%'; }
    if(composicionPeriodoLabel) composicionPeriodoLabel.textContent = PLABEL[PERIODOS[state.composicionPeriodoIdx]];
  }

  function renderComposicionChart(){
    const legendEl = document.getElementById('composicionLegend');
    const bodyEl = document.getElementById('composicionBody');
    if(!document.getElementById('composicionChart')) return;

    updateComposicionSliderUI();

    const idx = state.composicionPeriodoIdx;
    const meta = currencyMeta(state.curComposicion);

    const topRows = COMPOSICION_TOP_IDS.map(id=>{
      const act = DATA.actividades.find(a=>a.id===id);
      const s = act.series[idx];
      return { id, nombre: act.nombre, valor: (s ? s[meta.field] : null) || 0 };
    });
    const topTotal = topRows.reduce((sum,r)=>sum+r.valor, 0);
    let otrasTotal = 0;
    DATA.actividades.forEach(act=>{
      if(COMPOSICION_TOP_IDS.includes(act.id)) return;
      const s = act.series[idx];
      otrasTotal += (s ? s[meta.field] : null) || 0;
    });
    const total = topTotal + otrasTotal;

    if(!total){
      if(composicionChart){ composicionChart.destroy(); composicionChart = null; }
      if(legendEl) legendEl.innerHTML = '';
      if(bodyEl) bodyEl.innerHTML = '<tr><td colspan="4">Sin datos de composición para este trimestre.</td></tr>';
      return;
    }

    const rows = topRows.concat([{ id:null, nombre:'Otras', valor: otrasTotal }]);
    const rowsSorted = rows.slice().sort((a,b)=>b.valor-a.valor);

    const ctx = document.getElementById('composicionChart').getContext('2d');
    if(composicionChart) composicionChart.destroy();
    const surfaceColor = getComputedStyle(document.documentElement).getPropertyValue('--surface').trim();
    composicionChart = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: rows.map(r=>r.nombre),
        datasets: [{
          data: rows.map(r=>r.valor),
          backgroundColor: rows.map(r=>composicionColorFor(r.id)),
          borderColor: surfaceColor, borderWidth: 2,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (c)=>{
            const v = c.raw; const pct = total ? (v/total*100) : 0;
            return c.label + ': ' + fmtMillones(v, meta.prefix) + ' (' + fmtPct.format(pct) + '%)';
          } } },
        },
      },
    });

    if(legendEl){
      legendEl.innerHTML = rows.map(r=>
        '<span><i style="background:'+composicionColorFor(r.id)+'"></i>'+r.nombre+'</span>'
      ).join('');
    }
    if(bodyEl){
      bodyEl.innerHTML = rowsSorted.map(r=>{
        const pct = total ? (r.valor/total*100) : 0;
        return '<tr><td><i style="display:inline-block;width:11px;height:11px;border-radius:3px;background:'+composicionColorFor(r.id)+'"></i></td>'
          + '<td>'+r.nombre+'</td>'
          + '<td class="num mono">'+fmtMillones(r.valor, meta.prefix)+'</td>'
          + '<td class="num mono">'+fmtPct.format(pct)+'%</td></tr>';
      }).join('');
    }
  }

  // Comparación internacional: Crédito bancario al agro / PBI (%), Argentina
  // contra 5 países (planilla de elaboración propia que trajo Ciro, Nov-2026
  // -- ver data/internacional.json, generado una sola vez a partir de esa
  // planilla + INDEC/BCRA para la serie de Argentina). Solo se muestra para
  // "Total Agro" (ver renderSaldosView): no hay desglose por actividad para
  // los otros 5 países, así que compararlos contra una actividad puntual de
  // Argentina no tendría sentido.
  // Colores: mismos 6 matices categóricos ya validados por la skill de
  // dataviz para "Composición del crédito total" (ver --sector-* en
  // styles.css), en el MISMO orden consecutivo ya chequeado (industria ->
  // comercio -> agro -> construccion -> personas -> servicios) -- no se
  // reordena para no tener que revalidar. Argentina usa "agro" (el matiz
  // temático, además queda en el medio de la secuencia) y se destaca por
  // trazo más grueso y quedando dibujada arriba del resto, no por el color.
  function internacionalColorFor(pais){
    return getComputedStyle(document.documentElement).getPropertyValue(pais.cssVar).trim();
  }
  function renderInternacionalChart(){
    const canvas = document.getElementById('internacionalChart');
    if(!canvas || !DATA.internacional) return;
    const intl = DATA.internacional;
    const intlPeriodos = intl.periodos;
    // El rango de períodos de internacional.json es el mismo PERIODOS de
    // siempre (misma fuente, mismos 46 trimestres), así que se puede usar
    // directamente state.rangeStart/rangeEnd sin tener que buscar el índice
    // correspondiente -- pero se valida el largo igual, por las dudas.
    const startIdx = intlPeriodos.length===PERIODOS.length ? state.rangeStart : 0;
    const endIdx = intlPeriodos.length===PERIODOS.length ? state.rangeEnd : intlPeriodos.length-1;
    const labels = intlPeriodos.slice(startIdx, endIdx+1).map(p=>PLABEL[p] || String(p));
    const fmtPct2 = new Intl.NumberFormat('es-AR', {maximumFractionDigits:2, minimumFractionDigits:2});

    const datasets = intl.paises.map(pais=>{
      const color = internacionalColorFor(pais);
      const data = (intl.series[pais.id] || []).slice(startIdx, endIdx+1);
      return {
        label: pais.nombre,
        data,
        borderColor: color, backgroundColor: color,
        borderWidth: pais.enfasis ? 3 : 1.75,
        pointRadius: pais.enfasis ? 2.5 : 1.5,
        pointHoverRadius: 5,
        tension: .2, spanGaps: false,
        order: pais.enfasis ? 0 : 1, // dibuja a Argentina arriba del resto
      };
    });

    const styles = getComputedStyle(document.documentElement);
    const textColor = styles.getPropertyValue('--text-muted').trim();
    const gridColor = styles.getPropertyValue('--border').trim();

    const ctx = canvas.getContext('2d');
    if(intlChart) intlChart.destroy();
    intlChart = new Chart(ctx, {
      type: 'line',
      data: { labels, datasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label:(c)=> c.dataset.label + ': ' + (c.raw!=null ? fmtPct2.format(c.raw)+'%' : 'sin dato') } },
        },
        scales: {
          x: { grid:{display:false}, ticks:{ color:textColor, font:{size:11}, maxRotation:0, autoSkip:true } },
          y: { grid:{ color:gridColor }, ticks:{ color:textColor, font:{size:11}, callback:(v)=> fmtPct2.format(v)+'%' }, beginAtZero:true },
        },
      },
    });

    // La tabla de la derecha hace de referencia/leyenda del gráfico (pedido
    // de Ciro, Nov-2026: antes había una leyenda arriba Y una tabla aparte
    // más abajo, "dos partes separadas" -- ahora es un solo panel, con el
    // gráfico ocupando la columna ancha y la tabla la columna angosta de la
    // derecha, mismo patrón .intlgrid que .provgrid en Provincias). Cada
    // fila es clickeable y togglea la visibilidad de esa serie en el
    // gráfico -- data-idx guarda la posición ORIGINAL dentro de
    // intl.paises (el mismo orden que los datasets del chart), no la
    // posición ya reordenada por valor que se ve en pantalla. El último
    // valor de cada país toma el extremo derecho de la VENTANA elegida
    // (mismo criterio que el resto de las tarjetas "del período actual" en
    // este archivo), no siempre el último trimestre de toda la serie.
    const bodyEl = document.getElementById('internacionalBody');
    if(bodyEl){
      const rows = intl.paises.map((pais, idx)=>{
        const data = (intl.series[pais.id] || []).slice(startIdx, endIdx+1);
        let lastVal = null;
        for(let i=data.length-1; i>=0; i--){ if(data[i]!=null){ lastVal = data[i]; break; } }
        return { pais, idx, lastVal };
      }).sort((a,b)=> (b.lastVal||0) - (a.lastVal||0));
      bodyEl.innerHTML = rows.map(r=>
        '<tr data-idx="'+r.idx+'"><td><span class="swatch" style="background:'+internacionalColorFor(r.pais)+'"></span></td>'
        + '<td class="prov">'+r.pais.nombre+(r.pais.enfasis?' <span class="rank" style="width:auto;padding:0 6px;">AR</span>':'')+'</td>'
        + '<td class="num">'+(r.lastVal!=null ? fmtPct2.format(r.lastVal)+'%' : '—')+'</td></tr>'
      ).join('');
      bodyEl.querySelectorAll('tr[data-idx]').forEach(function(tr){
        tr.addEventListener('click', function(){
          const idx = Number(tr.dataset.idx);
          const visible = intlChart.isDatasetVisible(idx);
          intlChart.setDatasetVisibility(idx, !visible);
          intlChart.update();
          tr.classList.toggle('off', visible);
        });
      });
    }
  }

  function renderResumenTiles(){
    // Igual que el resto de la vista Resumen (ver renderDiffChart): la tarjeta
    // muestra el dato del extremo derecho de la ventana elegida en el slider,
    // no siempre el último trimestre de toda la serie.
    const last = RN[state.rangeEnd];
    const wrap = document.getElementById('resumenTiles');
    wrap.innerHTML='';
    if(!last){ return; }

    const t1 = document.createElement('div'); t1.className='tile';
    t1.innerHTML = '<div class="label">Tasa ponderada · pesos</div>'
      + '<div class="value mono">'+(last.tasa_pesos_ponderada!=null?fmtPct.format(last.tasa_pesos_ponderada)+'%':'—')+'</div>'
      + '<div class="unit">'+PLABEL[last.periodo]+', TNA</div>';
    wrap.appendChild(t1);

    const t2 = document.createElement('div'); t2.className='tile';
    t2.innerHTML = '<div class="label">Tasa ponderada · dólares</div>'
      + '<div class="value mono">'+(last.tasa_dolares_ponderada!=null?fmtPct.format(last.tasa_dolares_ponderada)+'%':'—')+'</div>'
      + '<div class="unit">'+PLABEL[last.periodo]+', TNA</div>';
    wrap.appendChild(t2);

    const t3 = document.createElement('div'); t3.className='tile';
    if(last.costo_efectivo_dolares!=null && last.tasa_pesos_ponderada!=null){
      const convienePesos = last.tasa_pesos_ponderada <= last.costo_efectivo_dolares;
      t3.innerHTML = '<div class="label">Costo efectivo · dólares</div>'
        + '<div class="value mono">'+fmtPct.format(last.costo_efectivo_dolares)+'%</div>'
        + '<span class="chip '+(convienePesos?'bad':'good')+'">'+(convienePesos?'▲ convino pesos':'▼ convino dólares')+'</span>';
    } else {
      t3.innerHTML = '<div class="label">Costo efectivo · dólares</div><div class="value mono">—</div><div class="unit">falta TC de hace 12 meses</div>';
    }
    wrap.appendChild(t3);
  }

  function renderResumenTasaChart(){
    const periodosVisible = PERIODOS.slice(state.rangeStart, state.rangeEnd+1);
    const rnVisible = RN.slice(state.rangeStart, state.rangeEnd+1);
    const labels = periodosVisible.map(p=>PLABEL[p]);
    const pesos = rnVisible.map(r=>r.tasa_pesos_ponderada);
    const dolares = rnVisible.map(r=>r.tasa_dolares_ponderada);

    const styles = getComputedStyle(document.documentElement);
    const accent = styles.getPropertyValue('--accent').trim();
    const gold = styles.getPropertyValue('--gold').trim();
    const textColor = styles.getPropertyValue('--text-muted').trim();
    const gridColor = styles.getPropertyValue('--border').trim();

    const ctx = document.getElementById('resumenTasaChart').getContext('2d');
    if(resumenTasaChart) resumenTasaChart.destroy();
    resumenTasaChart = new Chart(ctx, {
      type:'bar',
      data:{ labels, datasets:[
        { label:'Pesos', data: pesos, backgroundColor: accent, borderRadius:5, maxBarThickness:34 },
        { label:'Dólares', data: dolares, backgroundColor: gold, borderRadius:5, maxBarThickness:34 },
      ]},
      options:{
        responsive:true, maintainAspectRatio:false,
        plugins:{ legend:{display:false}, tooltip:{ callbacks:{ label:(c)=> c.dataset.label+': '+(c.raw!=null?fmtPct.format(c.raw)+'%':'sin dato') } } },
        scales:{
          x:{ grid:{display:false}, ticks:{ color:textColor, font:{size:11.5, weight:600} } },
          y:{ grid:{ color:gridColor }, ticks:{ color:textColor, font:{size:11}, callback:(v)=> v+'%' }, beginAtZero:true }
        }
      }
    });
    const legendEl = document.getElementById('resumenTasaLegend');
    legendEl.innerHTML =
      '<span class="toggle" data-idx="0"><i style="background:'+accent+'"></i>Pesos</span>'
      + '<span class="toggle" data-idx="1"><i style="background:'+gold+'"></i>Dólares</span>';
    legendEl.querySelectorAll('.toggle').forEach(function(el){
      el.onclick = function(){
        const idx = Number(el.dataset.idx);
        const visible = resumenTasaChart.isDatasetVisible(idx);
        resumenTasaChart.setDatasetVisibility(idx, !visible);
        resumenTasaChart.update();
        el.classList.toggle('off', visible);
      };
    });

    const jun25 = RN.find(r=>r.periodo===20250630);
    const checkEl = document.getElementById('checkPesosJun25');
    if(checkEl) checkEl.textContent = jun25 && jun25.tasa_pesos_ponderada!=null ? fmtPct.format(jun25.tasa_pesos_ponderada)+'%' : 'sin dato';
  }

  function renderDiffChart(){
    const idx = state.rangeEnd;
    const per = PERIODOS[idx];
    const rn = RN[idx];
    document.getElementById('diffDesc').innerHTML = 'Tasa en pesos de cada actividad, menos la tasa ponderada nacional ('+(rn&&rn.tasa_pesos_ponderada!=null?fmtPct.format(rn.tasa_pesos_ponderada)+'%':'—')+') en <b>'+PLABEL[per]+'</b>. En puntos porcentuales.';

    const rowsAll = DATA.actividades.map(act=>{
      const t = act.tasas[idx];
      if(!rn || rn.tasa_pesos_ponderada==null || !t || t.pesos==null) return null;
      return { nombre: act.nombre, diff: t.pesos - rn.tasa_pesos_ponderada };
    }).filter(Boolean);
    rowsAll.sort((a,b)=>b.diff-a.diff);

    // Por defecto se muestran solo las actividades más alejadas del
    // promedio (3 que más pagan + 3 que menos pagan); "Ver las N
    // actividades" despliega la lista completa. Si hay 6 o menos no
    // tiene sentido recortar, así que se muestra todo y se oculta el botón.
    const n = rowsAll.length;
    const showToggle = n > 6;
    const rows = (state.diffExpanded || !showToggle) ? rowsAll : rowsAll.slice(0,3).concat(rowsAll.slice(-3));

    const wrapEl = document.getElementById('diffChartWrap');
    if(wrapEl) wrapEl.style.height = (state.diffExpanded ? Math.max(460, rows.length*21) : 190) + 'px';

    const toggleBtn = document.getElementById('diffToggle');
    if(toggleBtn){
      toggleBtn.style.display = showToggle ? '' : 'none';
      toggleBtn.classList.toggle('open', state.diffExpanded);
      const labelEl = toggleBtn.querySelector('span');
      if(labelEl) labelEl.textContent = state.diffExpanded ? 'Ver menos' : ('Ver las '+n+' actividades');
    }

    const styles = getComputedStyle(document.documentElement);
    const badColor = styles.getPropertyValue('--bad-text').trim();
    const goodColor = styles.getPropertyValue('--good-text').trim();
    const textColor = styles.getPropertyValue('--text-muted').trim();
    const gridColor = styles.getPropertyValue('--border').trim();

    const ctx = document.getElementById('diffChart').getContext('2d');
    if(diffChart) diffChart.destroy();
    diffChart = new Chart(ctx, {
      type:'bar',
      data:{ labels: rows.map(r=>r.nombre), datasets:[{
        data: rows.map(r=>r.diff),
        backgroundColor: rows.map(r=> r.diff>=0 ? badColor : goodColor),
        borderRadius: 4,
        maxBarThickness: 22,
      }]},
      options:{
        indexAxis:'y',
        responsive:true, maintainAspectRatio:false,
        plugins:{ legend:{display:false}, tooltip:{ callbacks:{ label:(c)=> (c.raw>=0?'+':'')+fmt1.format(c.raw)+' pp vs. el promedio' } } },
        scales:{
          x:{ grid:{ color:gridColor }, ticks:{ color:textColor, font:{size:11}, callback:(v)=> (v>=0?'+':'')+v } },
          y:{ grid:{display:false}, ticks:{ color:textColor, font:{size:11.5, weight:600}, autoSkip:false } }
        }
      }
    });
  }

  const diffToggleBtn = document.getElementById('diffToggle');
  if(diffToggleBtn){
    diffToggleBtn.addEventListener('click', ()=>{
      state.diffExpanded = !state.diffExpanded;
      renderDiffChart();
    });
  }

  function renderCostoChart(){
    const periodosVisible = PERIODOS.slice(state.rangeStart, state.rangeEnd+1);
    const rnVisible = RN.slice(state.rangeStart, state.rangeEnd+1);
    const labels = periodosVisible.map(p=>PLABEL[p]);
    const pesos = rnVisible.map(r=>r.tasa_pesos_ponderada);
    const costoUsd = rnVisible.map(r=>r.costo_efectivo_dolares);

    const styles = getComputedStyle(document.documentElement);
    const accent = styles.getPropertyValue('--accent').trim();
    const gold = styles.getPropertyValue('--gold').trim();
    const textColor = styles.getPropertyValue('--text-muted').trim();
    const gridColor = styles.getPropertyValue('--border').trim();

    const ctx = document.getElementById('costoChart').getContext('2d');
    if(costoChart) costoChart.destroy();
    costoChart = new Chart(ctx, {
      type:'line',
      data:{ labels, datasets:[
        { label:'Crédito en pesos (tasa ponderada)', data: pesos, borderColor: accent, backgroundColor: accent, tension:.25, pointRadius:2, spanGaps:false },
        { label:'Crédito en dólares, costo efectivo en pesos', data: costoUsd, borderColor: gold, backgroundColor: gold, tension:.25, pointRadius:2, spanGaps:false },
      ]},
      options:{
        responsive:true, maintainAspectRatio:false,
        plugins:{ legend:{display:false}, tooltip:{ callbacks:{ label:(c)=> c.dataset.label+': '+(c.raw!=null?fmtPct.format(c.raw)+'%':'sin dato') } } },
        scales:{
          x:{ grid:{display:false}, ticks:{ color:textColor, font:{size:11}, maxRotation:0, autoSkip:true } },
          y:{ grid:{ color:gridColor }, ticks:{ color:textColor, font:{size:11}, callback:(v)=> v+'%' } }
        }
      }
    });
    const legendEl = document.getElementById('costoLegend');
    legendEl.innerHTML =
      '<span><i style="background:'+accent+'"></i>Crédito en pesos</span>'
      + '<span><i style="background:'+gold+'"></i>Crédito en dólares (costo efectivo en pesos)</span>';
  }

  // Nav pegajosa de cada pestaña (Saldos y Tasas comparten el mismo patrón:
  // hilo narrativo con una pregunta por sección) -- resalta la sección
  // visible a medida que se baja, usando IntersectionObserver en vez de un
  // listener de scroll. Mientras la pestaña no es la activa, su #view-*
  // está en display:none y no observa nada -- no hace falta reiniciarlo al
  // cambiar de pestaña.
  function initNarrativeNav(navId, tabName){
    const nav = document.getElementById(navId);
    if(!nav) return;
    const links = [...nav.querySelectorAll('a[href^="#"]')];
    const byId = {};
    const sections = links.map(a=>{
      const id = a.getAttribute('href').slice(1);
      byId[id] = a;
      return document.getElementById(id);
    }).filter(Boolean);
    if(!sections.length) return;
    function setActive(link){
      links.forEach(a=>a.classList.remove('active'));
      if(link) link.classList.add('active');
    }
    const observer = new IntersectionObserver((entries)=>{
      entries.forEach(entry=>{
        if(!entry.isIntersecting) return;
        setActive(byId[entry.target.id]);
      });
    }, { rootMargin:'-15% 0px -60% 0px', threshold:0 });
    sections.forEach(s=>observer.observe(s));

    // La última sección puede ser más corta que la "banda" de detección del
    // observer de arriba, así que su título nunca llega a cruzarla -- al
    // llegar al final de la página, se fuerza el último link como activo
    // (patrón estándar para el último ítem de un scroll-spy). Se toma el
    // último link VISIBLE (no simplemente el último del array): tanto
    // saldosNav (Participación/Sectores) como tasasNav (actividad real vs.
    // Total Agro) esconden algunos de sus links según la actividad elegida,
    // así que el literal último <a> del HTML no siempre es el último que
    // se ve en pantalla.
    let ticking = false;
    window.addEventListener('scroll', ()=>{
      if(state.tab!==tabName || ticking) return;
      ticking = true;
      requestAnimationFrame(()=>{
        ticking = false;
        const atBottom = (window.innerHeight + window.scrollY) >= (document.documentElement.scrollHeight - 4);
        if(atBottom){
          const visibles = links.filter(a=> a.offsetParent !== null);
          setActive(visibles[visibles.length-1] || links[links.length-1]);
        }
      });
    }, { passive:true });
  }
  initNarrativeNav('saldosNav', 'saldos');
  initNarrativeNav('tasasNav', 'tasas');
  initNarrativeNav('comercialNav', 'comercial');

  // ============================================================
  // Pestaña "Financiamiento" (antes "Crédito comercial"): de dónde salió
  // la plata para sembrar cada campaña -- capital propio vs. terceros, y
  // dentro de terceros, bancos+MAV vs. crédito comercial. Fuente: Bolsa de
  // Comercio de Rosario, Informativo Semanal, una nota por campaña (no es
  // un registro del BCRA como Saldos/Tasas: son estimaciones del sector,
  // via encuestas). No depende de DATA/dashboard_data.json -- es una serie
  // chica (5 campañas) que no amerita su propio pipeline de build_data.py,
  // así que vive acá como constante, ya verificada contra las 5 notas
  // originales (porcentajes exactamente como los reporta cada nota; los
  // montos en US$ se derivan multiplicando el total de cada campaña por
  // esos porcentajes, no se copian los sub-totales de cada nota, que
  // a veces difieren del propio informe por redondeo propio de +/-1%).
  function initFinanciamientoTab(){
    var YEARS = ['2021/22','2022/23','2023/24','2024/25','2025/26'];

    // total: inversión directa en siembra de los 6 cultivos (US$ M, tal
    // cual la nota de cada campaña). capitalPct: % financiado con capital
    // propio. bancmavPct/comercialPct: reparto DENTRO de terceros entre
    // bancos+MAV y crédito comercial. instSubtotalPct: % de terceros que
    // representa la lista de "instrumentos" de esa campaña -- en 2021/22 a
    // 2023/24 la nota reporta bancos y MAV por separado con su propio
    // desglose de instrumentos cada uno, así que acá se usa SOLO el de
    // bancos (no el combinado) para no inventar una mezcla que la fuente
    // nunca hizo; desde 2024/25 la propia Bolsa ya fusionó bancos+MAV en
    // una sola categoría con un único desglose, así que ahí coincide con
    // bancmavPct.
    var nivel1 = [
      {total:13367, capitalPct:30, bancmavPct:26, comercialPct:74, instSubtotalPct:20}, // 2021/22
      {total:16456, capitalPct:30, bancmavPct:27, comercialPct:72, instSubtotalPct:21}, // 2022/23
      {total:15024, capitalPct:25, bancmavPct:33, comercialPct:67, instSubtotalPct:23}, // 2023/24
      {total:13821, capitalPct:30, bancmavPct:34.4, comercialPct:65.6, instSubtotalPct:34.4}, // 2024/25
      {total:14747, capitalPct:30, bancmavPct:44.65, comercialPct:55.35, instSubtotalPct:44.65}  // 2025/26
    ];
    // Nota 2024/25: la bajada de la nota dice "66% comercial, 36% bancos y
    // MAV" (no suma 100). El cuerpo de la propia nota, la tabla de la
    // pág. 2 y la suma de los instrumentos bancarios (219+433+218+682+542+
    // 209+251+771 = US$3.325 M) coinciden en que bancos+MAV fue US$3.325 M
    // y comercial US$6.350 M sobre terceros = US$9.675 M -- eso da 34,4% y
    // 65,6%, no el 36%/66% redondeado de la bajada; se usan los primeros.
    // 2025/26: ídem, se usan los % exactos de la tabla resumen de la nota
    // (pág. 7: US$4.609 M y US$5.713 M sobre terceros = US$10.323 M) en vez
    // de los "45%"/"55%" redondeados del copete, para que el US$ de cada
    // campaña coincida con el de su propia tabla.

    // Dentro de crédito comercial: corredores/acopios/cooperativas,
    // proveedores de insumos (traders/exportadores) y mutuales. Muy
    // estable entre campañas (en 2022/23 hay además un 0,4% vía SGR que
    // la propia nota aclara que es para evitar doble conteo con bancos/MAV,
    // no un cuarto canal -- no se grafica aparte).
    var nivel2Pct = {
      corredores:  [68, 55, 55, 55, 55],
      proveedores: [27, 40, 40, 40, 40],
      mutuales:    [5, 5, 5, 5, 5]
    };

    var instrumentColors = {
      'Descuento de valores':                 '#1F6B3A',
      'Descuento de cheques y pagarés':       '#1F6B3A',
      'Préstamos bullet':                     '#2E86AB',
      'Tarjeta agro':                         '#B9822A',
      'Préstamos hipotecarios y prendarios':  '#8E44AD',
      'Acuerdos en cuenta corriente':         '#C0572A',
      'Forwards cedidos':                     '#17A398',
      'Préstamos con convenio para compra de insumos': '#D4A373',
      'Otras líneas':                         '#5C6B65',
      'Otras líneas y MAV':                   '#5C6B65'
    };

    // % dentro del crédito bancario (2021/22-2023/24) o bancos+MAV
    // combinado (2024/25-2025/26, ya fusionado por la propia Bolsa), tal
    // cual cada nota. Verificado contra el texto y, para 2023/24-2025/26,
    // también contra las tablas/infografías de cada informe.
    var instrumentos = [
      [ // 2021/22 -- solo bancos (el MAV se reportó aparte ese año)
        {label:'Tarjeta agro', pct:39},
        {label:'Otras líneas', pct:36},
        {label:'Descuento de valores', pct:18},
        {label:'Forwards cedidos', pct:7}
      ],
      [ // 2022/23 -- solo bancos
        {label:'Otras líneas', pct:49},
        {label:'Tarjeta agro', pct:33},
        {label:'Forwards cedidos', pct:9},
        {label:'Descuento de valores', pct:9}
      ],
      [ // 2023/24 -- solo bancos
        {label:'Descuento de cheques y pagarés', pct:31.8},
        {label:'Préstamos bullet', pct:27.4},
        {label:'Tarjeta agro', pct:12.4},
        {label:'Préstamos hipotecarios y prendarios', pct:10.7},
        {label:'Otras líneas', pct:9.3},
        {label:'Acuerdos en cuenta corriente', pct:5.4},
        {label:'Forwards cedidos', pct:3.0}
      ],
      [ // 2024/25 -- bancos + MAV combinado (ya fusionado por la Bolsa)
        {label:'Otras líneas y MAV', pct:23.2},
        {label:'Préstamos bullet', pct:20.5},
        {label:'Préstamos hipotecarios y prendarios', pct:16.3},
        {label:'Descuento de cheques y pagarés', pct:13.0},
        {label:'Préstamos con convenio para compra de insumos', pct:7.5},
        {label:'Tarjeta agro', pct:6.6},
        {label:'Forwards cedidos', pct:6.6},
        {label:'Acuerdos en cuenta corriente', pct:6.3}
      ],
      [ // 2025/26 -- bancos + MAV combinado
        {label:'Préstamos bullet', pct:24.2},
        {label:'Préstamos hipotecarios y prendarios', pct:20.1},
        {label:'Descuento de cheques y pagarés', pct:14.7},
        {label:'Préstamos con convenio para compra de insumos', pct:14.5},
        {label:'Otras líneas y MAV', pct:12.4},
        {label:'Tarjeta agro', pct:7.5},
        {label:'Acuerdos en cuenta corriente', pct:6.6}
      ]
    ];

    function fmtUSD(v){ return Math.round(v).toLocaleString('es-AR') + ' M'; }
    function fmtPct(v){ return (Math.round(v*10)/10).toString().replace('.0','') + '%'; }
    function round1(v){ return Math.round(v*10)/10; }

    function capitalUSD(i){ return nivel1[i].total * nivel1[i].capitalPct / 100; }
    function tercerosUSD(i){ return nivel1[i].total - capitalUSD(i); }
    function bancmavUSD(i){ return tercerosUSD(i) * nivel1[i].bancmavPct / 100; }
    function comercialUSD(i){ return tercerosUSD(i) * nivel1[i].comercialPct / 100; }
    function instSubtotalUSD(i){ return tercerosUSD(i) * nivel1[i].instSubtotalPct / 100; }

    // ---- Tiles (última campaña) ----
    (function renderTiles(){
      var i = YEARS.length - 1;
      var tilesEl = document.getElementById('ccTiles');
      if(!tilesEl) return;
      var bancmavPctTotal = nivel1[i].bancmavPct * tercerosUSD(i) / nivel1[i].total;
      var comercialPctTotal = nivel1[i].comercialPct * tercerosUSD(i) / nivel1[i].total;
      var items = [
        {label:'Inversión total · ' + YEARS[i], value: 'US$ ' + fmtUSD(nivel1[i].total), unit:'sobre el total a financiar'},
        {label:'Capital propio', value: fmtPct(nivel1[i].capitalPct), unit: 'US$ ' + fmtUSD(capitalUSD(i))},
        {label:'Bancos + MAV', value: fmtPct(bancmavPctTotal), unit: 'US$ ' + fmtUSD(bancmavUSD(i))},
        {label:'Crédito comercial', value: fmtPct(comercialPctTotal), unit: 'US$ ' + fmtUSD(comercialUSD(i))}
      ];
      tilesEl.innerHTML = items.map(function(it){
        return '<div class="tile"><div class="label">' + it.label + '</div>' +
          '<div class="value">' + it.value + '</div>' +
          '<div class="unit">' + it.unit + '</div></div>';
      }).join('');
    })();

    // ---- Chart 1: Panorama ----
    var panoramaColors = {capital:'#AFCBB6', bancmav:'#B9822A', comercial:'#1F6B3A'};
    var panoramaLabels = {capital:'Capital propio', bancmav:'Bancos + MAV', comercial:'Crédito comercial'};
    var panoramaLegendEl = document.getElementById('panoramaLegend');
    if(panoramaLegendEl){
      panoramaLegendEl.innerHTML = Object.keys(panoramaLabels).map(function(k){
        return '<span><i style="background:' + panoramaColors[k] + '"></i>' + panoramaLabels[k] + '</span>';
      }).join('');
    }
    var panoramaCanvas = document.getElementById('panoramaChart');
    if(panoramaCanvas){
      var panoramaChart = new Chart(panoramaCanvas, {
        type: 'bar',
        data: { labels: YEARS, datasets: [
          {label: panoramaLabels.capital, backgroundColor: panoramaColors.capital, data: []},
          {label: panoramaLabels.bancmav, backgroundColor: panoramaColors.bancmav, data: []},
          {label: panoramaLabels.comercial, backgroundColor: panoramaColors.comercial, data: []}
        ]},
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend:{display:false}, tooltip:{ callbacks:{ label:function(ctx){
            // Miles separados con punto (es-AR): fmtInt ya se usa para esto
            // en el resto del tablero (ver línea ~14). ctx.formattedValue no
            // alcanza acá porque Chart.js lo arma con el locale del
            // navegador, no con es-AR, así que en modo US$ millones podía
            // mostrarse "5714" en vez de "5.714".
            return ctx.dataset.label + ': ' + (ctx.chart.$mode==='usd' ? fmtInt.format(ctx.parsed.y) + ' M' : ctx.formattedValue + '%');
          } } } },
          scales: {
            x: { stacked:true, grid:{display:false}, ticks:{color:'#5C6B65', font:{size:11.5, weight:600}} },
            y: { stacked:true, beginAtZero:true, grid:{color:'#EEF3EF'}, ticks:{color:'#8A9A95', font:{size:11}, callback:function(v){ return fmtInt.format(v); }} }
          }
        }
      });
      function renderPanorama(mode){
        panoramaChart.$mode = mode;
        var d = panoramaChart.data.datasets;
        if(mode==='pct'){
          d[0].data = YEARS.map(function(_,i){ return round1(nivel1[i].capitalPct); });
          d[1].data = YEARS.map(function(_,i){ return round1(nivel1[i].bancmavPct * tercerosUSD(i) / nivel1[i].total); });
          d[2].data = YEARS.map(function(_,i){ return round1(nivel1[i].comercialPct * tercerosUSD(i) / nivel1[i].total); });
          panoramaChart.options.scales.y.max = 100;
        } else {
          d[0].data = YEARS.map(function(_,i){ return Math.round(capitalUSD(i)); });
          d[1].data = YEARS.map(function(_,i){ return Math.round(bancmavUSD(i)); });
          d[2].data = YEARS.map(function(_,i){ return Math.round(comercialUSD(i)); });
          panoramaChart.options.scales.y.max = undefined;
        }
        panoramaChart.update();
      }
      renderPanorama('pct');
      var panoramaSegEl = document.getElementById('panoramaSeg');
      if(panoramaSegEl) panoramaSegEl.addEventListener('click', function(e){
        var btn = e.target.closest('button'); if(!btn) return;
        this.querySelectorAll('button').forEach(function(b){ b.classList.remove('active'); });
        btn.classList.add('active');
        renderPanorama(btn.dataset.mode);
      });
    }

    // ---- Chart 2: Canales comerciales ----
    var canalesColors = {corredores:'#1F6B3A', proveedores:'#B9822A', mutuales:'#C9A66B'};
    var canalesLabels = {corredores:'Corredores, acopios y cooperativas', proveedores:'Proveedores de insumos y exportadores', mutuales:'Mutuales'};
    var canalesLegendEl = document.getElementById('canalesLegend');
    if(canalesLegendEl){
      canalesLegendEl.innerHTML = Object.keys(canalesLabels).map(function(k){
        return '<span><i style="background:' + canalesColors[k] + '"></i>' + canalesLabels[k] + '</span>';
      }).join('');
    }
    var canalesCanvas = document.getElementById('canalesChart');
    if(canalesCanvas){
      var canalesChart = new Chart(canalesCanvas, {
        type: 'bar',
        data: { labels: YEARS, datasets: [
          {label: canalesLabels.corredores, backgroundColor: canalesColors.corredores, data: []},
          {label: canalesLabels.proveedores, backgroundColor: canalesColors.proveedores, data: []},
          {label: canalesLabels.mutuales, backgroundColor: canalesColors.mutuales, data: []}
        ]},
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend:{display:false}, tooltip:{ callbacks:{ label:function(ctx){
            // Mismo fix de separador de miles que en el chart de Panorama (ver comentario ahí arriba).
            return ctx.dataset.label + ': ' + (ctx.chart.$mode==='usd' ? fmtInt.format(ctx.parsed.y) + ' M' : ctx.formattedValue + '%');
          } } } },
          scales: {
            x: { stacked:true, grid:{display:false}, ticks:{color:'#5C6B65', font:{size:11.5, weight:600}} },
            y: { stacked:true, beginAtZero:true, grid:{color:'#EEF3EF'}, ticks:{color:'#8A9A95', font:{size:11}, callback:function(v){ return fmtInt.format(v); }} }
          }
        }
      });
      function renderCanales(mode){
        canalesChart.$mode = mode;
        var d = canalesChart.data.datasets;
        if(mode==='pct'){
          d[0].data = nivel2Pct.corredores.slice();
          d[1].data = nivel2Pct.proveedores.slice();
          d[2].data = nivel2Pct.mutuales.slice();
          canalesChart.options.scales.y.max = 100;
        } else {
          d[0].data = YEARS.map(function(_,i){ return Math.round(comercialUSD(i) * nivel2Pct.corredores[i] / 100); });
          d[1].data = YEARS.map(function(_,i){ return Math.round(comercialUSD(i) * nivel2Pct.proveedores[i] / 100); });
          d[2].data = YEARS.map(function(_,i){ return Math.round(comercialUSD(i) * nivel2Pct.mutuales[i] / 100); });
          canalesChart.options.scales.y.max = undefined;
        }
        canalesChart.update();
      }
      renderCanales('pct');
      var canalesSegEl = document.getElementById('canalesSeg');
      if(canalesSegEl) canalesSegEl.addEventListener('click', function(e){
        var btn = e.target.closest('button'); if(!btn) return;
        this.querySelectorAll('button').forEach(function(b){ b.classList.remove('active'); });
        btn.classList.add('active');
        renderCanales(btn.dataset.mode);
      });
    }

    // ---- Chart 3: Instrumentos bancarios (por campaña, no comparable) ----
    var instYearSeg = document.getElementById('instYearSeg');
    var instChartCanvas = document.getElementById('instChart');
    if(instYearSeg && instChartCanvas){
      instYearSeg.innerHTML = YEARS.map(function(y,i){
        return '<button data-i="' + i + '"' + (i===YEARS.length-1 ? ' class="active"' : '') + '>' + y + '</button>';
      }).join('');
      var instChart = new Chart(instChartCanvas, {
        type: 'doughnut',
        data: { labels: [], datasets: [{ data: [], backgroundColor: [], borderColor:'#FFFFFF', borderWidth:2 }] },
        options: {
          responsive: true, maintainAspectRatio: false, cutout: '62%',
          plugins: { legend:{display:false}, tooltip:{ callbacks:{ label:function(ctx){ return ctx.label + ': ' + ctx.formattedValue + '%'; } } } }
        }
      });
      function renderInstrumentos(yearIndex){
        var list = instrumentos[yearIndex].slice().sort(function(a,b){ return b.pct - a.pct; });
        var subtotal = instSubtotalUSD(yearIndex);
        instChart.data.labels = list.map(function(it){ return it.label; });
        instChart.data.datasets[0].data = list.map(function(it){ return it.pct; });
        instChart.data.datasets[0].backgroundColor = list.map(function(it){ return instrumentColors[it.label] || '#8A9A95'; });
        instChart.update();
        var instLegendEl = document.getElementById('instLegend');
        if(instLegendEl) instLegendEl.innerHTML = list.map(function(it){
          return '<span><i style="background:' + (instrumentColors[it.label]||'#8A9A95') + '"></i>' + it.label + '</span>';
        }).join('');
        var instBodyEl = document.getElementById('instBody');
        if(instBodyEl) instBodyEl.innerHTML = list.map(function(it){
          var usd = subtotal * it.pct / 100;
          return '<tr><td><span class="swatch" style="background:' + (instrumentColors[it.label]||'#8A9A95') + '"></span></td>' +
            '<td class="prov">' + it.label + '</td>' +
            '<td class="num">' + it.pct + '%</td>' +
            '<td class="num sharecol">US$ ' + fmtUSD(usd) + '</td></tr>';
        }).join('');
      }
      renderInstrumentos(YEARS.length - 1);
      instYearSeg.addEventListener('click', function(e){
        var btn = e.target.closest('button'); if(!btn) return;
        this.querySelectorAll('button').forEach(function(b){ b.classList.remove('active'); });
        btn.classList.add('active');
        renderInstrumentos(parseInt(btn.dataset.i, 10));
      });
    }
  }
  initFinanciamientoTab();

  function syncPills(){
    renderPills(document.getElementById('actSidebar'), pillClicked);
  }
  function pillClicked(){
    syncPills();
    if(state.tab==='saldos') renderSaldosView();
    else if(state.tab==='tasas') renderTasasView();
  }
  function renderAll(){
    syncPills();
    if(state.tab==='saldos') renderSaldosView();
    else if(state.tab==='tasas') renderTasasView();
    // "comercial" no depende de la actividad/pestaña elegida: se arma una
    // sola vez en initFinanciamientoTab() más abajo, no en cada renderAll().
  }

  const nActEl = document.getElementById('nActividadesResumen');
  if(nActEl) nActEl.textContent = DATA.actividades.length;

  renderAll();

  }
  boot();
})();
