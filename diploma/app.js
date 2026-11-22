(() => {
  'use strict';

  const IMG_W = 2480, IMG_H = 3508;           // arte original (300 dpi)
  const PDF_W = 595.28, PDF_H = 841.89;       // A4 em pontos
  const SHIFT = 0.36;                         // baseline = centro + SHIFT * tamanho (centraliza a altura das maiúsculas)

  const $ = (id) => document.getElementById(id);
  const form = $('form'), nome = $('nome'), entregue = $('entregue'), data = $('data');
  const tela = $('tela'), ctx = tela.getContext('2d');
  const btnPdf = $('baixar'), btnPrint = $('imprimir');

  let campos = null, fontBytes = null, fonteOk = false;
  const previas = {};

  const kitAtual = () => form.querySelector('input[name="kit"]:checked').value;

  // data padrão: hoje
  const hoje = new Date();
  data.value = [hoje.getDate(), hoje.getMonth() + 1].map(n => String(n).padStart(2, '0')).join('/') + '/' + hoje.getFullYear();

  // máscara simples dd/mm/aaaa
  data.addEventListener('input', () => {
    const d = data.value.replace(/\D/g, '').slice(0, 8);
    data.value = d.length > 4 ? `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}` : d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d;
  });

  function textos() {
    return { nome: nome.value.trim(), entregue: entregue.value.trim(), data: data.value.trim() };
  }

  // maior tamanho (em pt) entre max e min que cabe na largura; mede com a função recebida
  function caber(texto, c, medir) {
    let pt = c.fonte_max_pt;
    while (pt > c.fonte_min_pt && medir(texto, pt) > c.largura_pt) pt -= 0.5;
    return pt;
  }

  function carregarImagem(src) {
    return new Promise((ok, erro) => { const i = new Image(); i.onload = () => ok(i); i.onerror = erro; i.src = src; });
  }

  async function previa(kit) {
    if (!previas[kit]) previas[kit] = carregarImagem(`img/prev-${kit}.webp`);
    return previas[kit];
  }

  // desenha num canvas qualquer, na largura dele
  async function desenhar(canvas, fundo) {
    const c2 = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height, esc = W / IMG_W, ptPx = W / PDF_W;
    c2.clearRect(0, 0, W, H);
    c2.drawImage(fundo, 0, 0, W, H);
    if (!campos) return;
    const cfg = campos.kits[kitAtual()], t = textos();
    for (const chave of ['nome', 'entregue', 'data']) {
      const txt = t[chave];
      if (!txt) continue;
      const c = cfg[chave];
      const medir = (s, pt) => { c2.font = `800 ${pt * ptPx}px Baloo2PDF, 'Baloo 2', sans-serif`; return c2.measureText(s).width / ptPx; };
      const pt = caber(txt, { ...c, largura_pt: c.largura * PDF_W / IMG_W }, medir);
      c2.font = `800 ${pt * ptPx}px Baloo2PDF, 'Baloo 2', sans-serif`;
      c2.fillStyle = c.cor;
      c2.textAlign = 'center';
      c2.textBaseline = 'alphabetic';
      const cx = (c.x + c.largura / 2) * esc;
      const cy = (c.y + c.altura / 2) * esc + SHIFT * pt * ptPx;
      c2.fillText(txt, cx, cy);
    }
  }

  async function atualizar() {
    try { await desenhar(tela, await previa(kitAtual())); } catch (e) { console.error(e); }
  }

  function validar() {
    const ok = nome.value.trim().length > 0;
    nome.setAttribute('aria-invalid', ok ? 'false' : 'true');
    $('nome-erro').hidden = ok;
    if (!ok) nome.focus();
    return ok;
  }

  function nomeArquivo() {
    const base = nome.value.trim().normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return `diploma-${base || 'pulim'}.pdf`;
  }

  async function gerarPdf() {
    const { PDFDocument, rgb } = window.PDFLib;
    const kit = kitAtual(), cfg = campos.kits[kit], t = textos();
    const doc = await PDFDocument.create();
    doc.registerFontkit(window.fontkit);
    doc.setTitle(`Diploma · ${t.nome}`);
    doc.setAuthor('Pulim Play');
    const fonte = await doc.embedFont(fontBytes, { subset: true });
    const png = await doc.embedPng(await (await fetch(`img/diploma-${kit}.png`)).arrayBuffer());
    const pag = doc.addPage([PDF_W, PDF_H]);
    pag.drawImage(png, { x: 0, y: 0, width: PDF_W, height: PDF_H });
    const s = PDF_W / IMG_W;
    for (const chave of ['nome', 'entregue', 'data']) {
      const txt = t[chave];
      if (!txt) continue;
      const c = cfg[chave];
      const pt = caber(txt, { ...c, largura_pt: c.largura * s }, (str, size) => fonte.widthOfTextAtSize(str, size));
      const w = fonte.widthOfTextAtSize(txt, pt);
      const cx = (c.x + c.largura / 2) * s;
      const cyTopo = (c.y + c.altura / 2) * s;
      const hex = c.cor.replace('#', '');
      pag.drawText(txt, {
        x: cx - w / 2,
        y: PDF_H - cyTopo - SHIFT * pt,
        size: pt,
        font: fonte,
        color: rgb(parseInt(hex.slice(0, 2), 16) / 255, parseInt(hex.slice(2, 4), 16) / 255, parseInt(hex.slice(4, 6), 16) / 255)
      });
    }
    return doc.save();
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!validar() || !campos || !fontBytes) return;
    btnPdf.disabled = true; btnPdf.textContent = 'Gerando…';
    try {
      const bytes = await gerarPdf();
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url; a.download = nomeArquivo();
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (err) {
      console.error(err);
      alert('Não consegui gerar o PDF. Tente de novo ou use o botão Imprimir.');
    } finally {
      btnPdf.disabled = false; btnPdf.textContent = 'Baixar PDF';
    }
  });

  btnPrint.addEventListener('click', async () => {
    if (!validar()) return;
    btnPrint.disabled = true;
    try {
      const fundo = await carregarImagem(`img/diploma-${kitAtual()}.png`);
      const c = document.createElement('canvas');
      c.width = IMG_W; c.height = IMG_H;
      await desenhar(c, fundo);
      const img = $('impressao');
      await new Promise(ok => { img.onload = ok; img.src = c.toDataURL('image/png'); });
      window.print();
    } catch (err) { console.error(err); }
    finally { btnPrint.disabled = false; }
  });

  form.addEventListener('input', (e) => {
    if (e.target === nome && nome.value.trim()) { nome.setAttribute('aria-invalid', 'false'); $('nome-erro').hidden = true; }
    atualizar();
  });
  form.addEventListener('change', atualizar);

  // carregamento inicial: posições, fonte (para o canvas e para o PDF) e primeira prévia
  (async () => {
    try {
      const [cfg, bytes] = await Promise.all([
        fetch('campos.json').then(r => r.json()),
        fetch('fonts/Baloo2-ExtraBold.ttf').then(r => r.arrayBuffer())
      ]);
      campos = cfg; fontBytes = bytes;
      const ff = new FontFace('Baloo2PDF', bytes, { weight: '800' });
      await ff.load(); document.fonts.add(ff); fonteOk = true;
    } catch (e) { console.error(e); }
    atualizar();
    ['olimpiada', 'detetives', 'ferias'].forEach(previa);
  })();
})();
