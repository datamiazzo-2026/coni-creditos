(function(){
  async function boot(){
    const DATA = await fetch('data/dashboard_data.json').then(r=>r.json());

  
  const PERIODOS = DATA.periodos;
  const PLABEL = DATA.periodos_label;

  const fmt1 = new Intl.NumberFormat('es-AR', {maximumFractionDigits:1, minimumFractionDigits:1});
  const fmtPct = new Intl.NumberFormat('es-AR', {maximumFractionDigits:1, minimumFractionDigits:1});
  const fmtInt = new Intl.NumberFormat('es-AR', {maximumFractionDigits:0});

  // Elige la escala (millones / miles / unidad) según la magnitud del valor,
  // para que un monto chico (ej. el saldo de una provincia con poco crédito)
  // no se vea siempre como "0,0 M".
  function pickScale(maxAbs){
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
  function currencyMeta(cur){
    if(cur==='pesos') return {prefix:'$', field:'pesos_ars', provField:'pesos_ars', label:'en pesos'};
    if(cur==='dolares') return {prefix:'US$', field:'dolares_usd', provField:'dolares_usd', label:'en dólares'};
    return {prefix:'US$', field:'total_usd', provField:'total_usd', label:'total, equivalente en US$'};
  }

  const state = { tab:'saldos', actId: DATA.actividades[0].id, cur:'total', rangeStart:0, rangeEnd: PERIODOS.length-1 };

  // ---------- Slider de ventana de tiempo (compartido entre pestañas) ----------
  const rangeMin = document.getElementById('rangeMin');
  const rangeMax = document.getElementById('rangeMax');
  const rangeFill = document.getElementById('rangeFill');
  const rangeValueLabel = document.getElementById('rangeValueLabel');

  function updateRangeUI(){
    const a = state.rangeStart, b = state.rangeEnd;
    const lastIdx = PERIODOS.length-1;
    const pctA = lastIdx ? (a/lastIdx*100) : 0;
    const pctB = lastIdx ? (b/lastIdx*100) : 100;
    rangeFill.style.left = pctA+'%';
    rangeFill.style.right = (100-pctB)+'%';
    rangeValueLabel.textContent = PLABEL[PERIODOS[a]]+' — '+PLABEL[PERIODOS[b]];
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
  } else {
    document.querySelector('.rangepanel').style.display = 'none';
  }
  updateRangeUI();

  // El slider es un único elemento compartido entre pestañas (mismo estado,
  // mismos listeners) -- en vez de duplicarlo, lo movemos con appendChild
  // al slot de la pestaña activa, siempre debajo del gráfico principal.
  function moveRangeSlider(){
    const slot = document.getElementById('rangeSlot-'+state.tab);
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

  function getAct(id){ return DATA.actividades.find(a=>a.id===id); }

  // ---------- Activity sidebar ----------
  function renderPills(container, onClick){
    container.innerHTML='';
    DATA.actividades.forEach(a=>{
      const b = document.createElement('button');
      b.className = 'sbrow' + (a.id===state.actId ? ' active':'');
      const limitada = !a.saldos_moneda_completo || !a.tasas_completo;
      b.innerHTML = '<span>'+a.nombre+'</span>' + (limitada ? '<span class="dot" title="Datos parciales: ver aviso en la vista"></span>' : '');
      b.addEventListener('click', ()=>{ state.actId=a.id; onClick(); });
      container.appendChild(b);
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
    document.getElementById('view-resumen').style.display = state.tab==='resumen' ? '' : 'none';
    document.getElementById('mainGrid').classList.toggle('no-sidebar', state.tab==='resumen');
    moveRangeSlider();
    renderAll();
  });

  document.getElementById('curSeg').addEventListener('click', (e)=>{
    const btn = e.target.closest('button[data-cur]');
    if(!btn || btn.disabled) return;
    state.cur = btn.dataset.cur;
    [...document.getElementById('curSeg').children].forEach(c=>c.classList.toggle('active', c===btn));
    renderSaldosView();
  });

  let evolChart, tasaChart;

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

    const tileCobertura = document.createElement('div');
    tileCobertura.className='tile';
    const nTrim = series.filter(s=>s).length;
    tileCobertura.innerHTML = '<div class="label">Cobertura de datos</div>'
      + '<div class="value mono">'+nTrim+' / '+PERIODOS.length+'</div>'
      + '<div class="unit">'+(act.saldos_total_completo ? 'trimestres con dato' : 'trimestres con saldo total')+'</div>';
    wrap.appendChild(tileCobertura);
  }

  function renderChart(act){
    const meta = currencyMeta(state.cur);
    const periodosVisible = PERIODOS.slice(state.rangeStart, state.rangeEnd+1);
    const labels = periodosVisible.map(p=>PLABEL[p]);
    const values = act.series.slice(state.rangeStart, state.rangeEnd+1)
      .map(s => s && s[meta.field]!==undefined ? s[meta.field] : null);
    const lastIdx = values.reduce((acc,v,i)=> v!==null ? i : acc, -1);
    const maxAbs = values.reduce((m,v)=> v!==null ? Math.max(m, Math.abs(v)) : m, 0);
    const scale = pickScale(maxAbs);

    const styles = getComputedStyle(document.documentElement);
    const muted = styles.getPropertyValue('--bar-muted').trim();
    const hi = styles.getPropertyValue('--bar-highlight').trim();
    const textColor = styles.getPropertyValue('--text-muted').trim();
    const gridColor = styles.getPropertyValue('--border').trim();

    const bg = values.map((v,i)=> i===lastIdx ? hi : muted);

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
          tooltip:{ callbacks:{ label:(c)=> meta.prefix+' '+fmt1.format(c.raw)+scale.suf } }
        },
        scales:{
          x:{ grid:{display:false}, ticks:{ color:textColor, font:{size:11.5, weight:600} } },
          y:{ grid:{ color:gridColor }, ticks:{ color:textColor, font:{size:11}, callback:(v)=> meta.prefix+' '+fmt1.format(v)+scale.suf }, beginAtZero:true }
        }
      }
    });

    const rangoLbl = periodosVisible.length ? (PLABEL[periodosVisible[0]]+' a '+PLABEL[periodosVisible[periodosVisible.length-1]]) : '';
    document.getElementById('chartDesc').innerHTML = 'Saldo <b>'+meta.label+'</b> de <b>'+act.nombre+'</b> por trimestre, '+rangoLbl+'. La última barra marca el corte más reciente disponible en la ventana elegida.';
    document.getElementById('chartLegend').innerHTML =
      '<span><i style="background:'+muted+'"></i>trimestre anterior</span>'
      + '<span><i style="background:'+hi+'"></i>último dato</span>';
  }

  function renderProvinceTable(act){
    const meta = currencyMeta(state.cur);
    const provs = (act.provincias && act.provincias[meta.provField]) || {};
    const entries = Object.entries(provs).filter(([,v])=> v!==null && v!==undefined);
    entries.sort((a,b)=> b[1]-a[1]);
    const total = entries.reduce((s,[,v])=>s+v,0);
    const top = entries.slice(0,10);
    const max = top.length ? top[0][1] : 1;

    const body = document.getElementById('provBody');
    body.innerHTML='';
    if(!top.length){
      body.innerHTML = '<tr><td colspan="4" style="color:var(--text-faint); padding:16px 10px;">No hay desglose por provincia para esta vista de moneda.</td></tr>';
    } else {
      top.forEach(([name,val], i)=>{
        const tr = document.createElement('tr');
        const pct = total ? (val/total*100) : 0;
        const w = max ? (val/max*100) : 0;
        tr.innerHTML = '<td><span class="rank">'+(i+1)+'</span></td>'
          + '<td class="prov">'+name+'</td>'
          + '<td class="num mono">'+fmtMillones(val, meta.prefix)+'<div class="barcell"><i style="width:'+w.toFixed(1)+'%"></i></div></td>'
          + '<td class="num sharecol mono">'+fmtPct.format(pct)+'%</td>';
        body.appendChild(tr);
      });
    }
    document.getElementById('provDesc').innerHTML = 'Ranking de provincias por saldo <b>'+meta.label+'</b> al último dato disponible ('+PLABEL[act.ultimo_periodo]+').';
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

    const segBtns = document.getElementById('curSeg').querySelectorAll('button');
    segBtns.forEach(b=>{
      const c = b.dataset.cur;
      b.disabled = !act.saldos_moneda_completo && c!=='total';
    });
    if(!act.saldos_moneda_completo && state.cur!=='total'){
      state.cur = 'total';
      segBtns.forEach(b=>b.classList.toggle('active', b.dataset.cur==='total'));
    }

    renderTiles(act);
    renderChart(act);
    renderProvinceTable(act);
  }

  function renderTasaChart(act){
    const periodosVisible = PERIODOS.slice(state.rangeStart, state.rangeEnd+1);
    const labels = periodosVisible.map(p=>PLABEL[p]);
    const tasasVisible = act.tasas.slice(state.rangeStart, state.rangeEnd+1);
    const pesos = tasasVisible.map(t=>t.pesos);
    const dolares = tasasVisible.map(t=>t.dolares);

    const styles = getComputedStyle(document.documentElement);
    const accent = styles.getPropertyValue('--accent').trim();
    const gold = styles.getPropertyValue('--gold').trim();
    const textColor = styles.getPropertyValue('--text-muted').trim();
    const gridColor = styles.getPropertyValue('--border').trim();

    const ctx = document.getElementById('tasaChart').getContext('2d');
    if(tasaChart) tasaChart.destroy();
    tasaChart = new Chart(ctx, {
      type:'bar',
      data:{ labels, datasets:[
        { label:'Pesos', data: pesos, backgroundColor: accent, borderRadius:5, maxBarThickness:34 },
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
    const legendEl = document.getElementById('tasaLegend');
    legendEl.innerHTML =
      '<span class="toggle" data-idx="0"><i style="background:'+accent+'"></i>Pesos</span>'
      + '<span class="toggle" data-idx="1"><i style="background:'+gold+'"></i>Dólares</span>';
    legendEl.querySelectorAll('.toggle').forEach(function(el){
      el.onclick = function(){
        const idx = Number(el.dataset.idx);
        const visible = tasaChart.isDatasetVisible(idx);
        tasaChart.setDatasetVisibility(idx, !visible);
        tasaChart.update();
        el.classList.toggle('off', visible);
      };
    });
  }

  function renderTasaTables(act){
    const provs = act.tasas_provincias.pesos || {};
    const entries = Object.entries(provs).filter(([,v])=> v!==null && v!==undefined);
    entries.sort((a,b)=> b[1]-a[1]);
    const top = entries.slice(0,6);
    const bottom = entries.slice(-6).reverse();

    function fillTable(el, list){
      el.innerHTML='';
      list.forEach(([name,val],i)=>{
        const tr = document.createElement('tr');
        tr.innerHTML = '<td><span class="rank">'+(i+1)+'</span></td><td class="prov">'+name+'</td><td class="num mono">'+fmtPct.format(val)+'%</td>';
        el.appendChild(tr);
      });
      if(!list.length) el.innerHTML = '<tr><td colspan="3" style="color:var(--text-faint); padding:16px 10px;">Sin datos.</td></tr>';
    }
    fillTable(document.getElementById('tasaTopBody'), top);
    fillTable(document.getElementById('tasaBottomBody'), bottom);
  }

  function renderTasasView(){
    const act = getAct(state.actId);
    const noteEl = document.getElementById('partialNoteTasas');
    const noteText = document.getElementById('partialNoteTasasText');
    if(!act.tasas_completo){
      const withData = act.tasas.filter(t=> t.pesos!==null || t.dolares!==null);
      const lastT = withData[withData.length-1];
      const soloPesos = withData.every(t=> t.dolares===null);
      noteText.innerHTML = lastT
        ? 'Esta actividad solo tiene tasa reportada hasta <b>'+PLABEL[lastT.periodo]+'</b>'+(soloPesos ? ', únicamente en pesos.' : '.')
        : 'Esta actividad no tiene tasa reportada.';
      noteEl.style.display = 'flex';
    } else {
      noteEl.style.display = 'none';
    }
    renderTasaChart(act);
    renderTasaTables(act);
  }

  // ---------- Resumen nacional: tasa ponderada, diferencial, pesos vs. dólares ----------
  let resumenTasaChart, diffChart, costoChart;
  const RN = DATA.resumen_nacional || [];

  function renderResumenTiles(){
    const last = RN[RN.length-1];
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

    const rows = DATA.actividades.map(act=>{
      const t = act.tasas[idx];
      if(!rn || rn.tasa_pesos_ponderada==null || !t || t.pesos==null) return null;
      return { nombre: act.nombre, diff: t.pesos - rn.tasa_pesos_ponderada };
    }).filter(Boolean);
    rows.sort((a,b)=>b.diff-a.diff);

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
          y:{ grid:{display:false}, ticks:{ color:textColor, font:{size:11.5, weight:600} } }
        }
      }
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

  function renderResumenView(){
    renderResumenTiles();
    renderResumenTasaChart();
    renderDiffChart();
    renderCostoChart();
  }

  function syncPills(){
    renderPills(document.getElementById('actSidebar'), pillClicked);
  }
  function pillClicked(){
    syncPills();
    if(state.tab==='saldos') renderSaldosView(); else renderTasasView();
  }
  function renderAll(){
    if(state.tab==='resumen'){ renderResumenView(); return; }
    syncPills();
    if(state.tab==='saldos') renderSaldosView(); else renderTasasView();
  }

  renderAll();

  }
  boot();
})();
