'use strict';

const form = document.querySelector('#diploma-form');
const nome = document.querySelector('#nome');
const entregue = document.querySelector('#entregue');
const data = document.querySelector('#data');
const canvas = document.querySelector('#diploma');
const context = canvas.getContext('2d');
const baixar = document.querySelector('#baixar');
const imprimir = document.querySelector('#imprimir');
const status = document.querySelector('#status');
const pageWidth = 595.28;
const pageHeight = 841.89;
const scale = pageWidth / canvas.width;
const artworks = new Map(
  [...form.querySelectorAll('input[name="kit"]')].map(input => [
    input.value, input.labels[0].querySelector('img'),
  ]),
);
let campos;
let fontBytes;
let diplomaFont;
let busy = false;

const today = new Date();
const twoDigits = number => String(number).padStart(2, '0');
data.value = [
  twoDigits(today.getDate()), twoDigits(today.getMonth() + 1), today.getFullYear(),
].join('/');

async function fetchAsset(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error('Falha ao carregar ' + path);
  return response;
}

function currentDiploma() {
  const kit = form.elements.kit.value;
  const values = { nome: nome.value, entregue: entregue.value, data: data.value };
  const fields = Object.entries(values).flatMap(([key, value]) => {
    const text = value.trim().normalize('NFC');
    if (!text) return [];

    const box = campos.kits[kit][key];
    const run = diplomaFont.layout(text);
    const units = diplomaFont.unitsPerEm;
    const textWidth = run.glyphs.reduce((width, glyph) => width + glyph.advanceWidth, 0);
    const { minY, maxY } = run.bbox;
    if (!Number.isFinite(minY) || !Number.isFinite(maxY)) return [];

    const widthPerPoint = textWidth / units;
    const available = box.largura * scale;
    const size = Math.max(box.fonte_min_pt, Math.min(box.fonte_max_pt, available / widthPerPoint));
    const width = size * widthPerPoint;
    const stretch = width > available ? available / width : 1;
    const centerX = (box.x + box.largura / 2) * scale;
    const centerY = (box.y + box.altura / 2) * scale;
    const baselineOffset = (minY + maxY) / 2 * size / units;

    return [{
      text, size, stretch, color: box.cor,
      x: centerX - width * stretch / 2,
      baseline: centerY + baselineOffset,
    }];
  });

  return { artwork: artworks.get(kit), fields, name: values.nome.trim().normalize('NFC') };
}

function updatePreview() {
  if (!diplomaFont) return;

  const { artwork, fields, name } = currentDiploma();
  context.drawImage(artwork, 0, 0, canvas.width, canvas.height);
  context.textBaseline = 'alphabetic';
  for (const field of fields) {
    context.save();
    context.translate(field.x / scale, field.baseline / scale);
    context.scale(field.stretch, 1);
    context.font = '800 ' + field.size / scale + 'px "Baloo Diploma"';
    context.fillStyle = field.color;
    context.fillText(field.text, 0, 0);
    context.restore();
  }

  const kitLabel = artwork.parentElement.textContent.trim();
  canvas.setAttribute('aria-label', name
    ? 'Prévia do diploma de ' + name + ' — ' + kitLabel
    : 'Prévia do diploma — ' + kitLabel);
}

function validate() {
  for (const input of [nome, entregue]) {
    const value = input.value.trim().normalize('NFC');
    const supported = [...value].every(character => diplomaFont.hasGlyphForCodePoint(character.codePointAt(0)));
    input.setCustomValidity(supported ? '' : 'Use caracteres disponíveis na fonte do diploma.');
  }
  if (!nome.value.trim()) nome.setCustomValidity('Digite o nome da criança.');

  const value = data.value.trim();
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  let validDate = !value;
  if (match) {
    const [, day, month, year] = match.map(Number);
    const date = new Date(0);
    date.setFullYear(year, month - 1, day);
    validDate = year > 0 && date.getFullYear() === year
      && date.getMonth() === month - 1 && date.getDate() === day;
  }
  data.setCustomValidity(validDate ? '' : 'Digite uma data válida no formato dd/mm/aaaa.');
  return form.reportValidity();
}

async function createPdf({ artwork, fields }) {
  const { PDFDocument, rgb, pushGraphicsState, concatTransformationMatrix, popGraphicsState } = PDFLib;
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(fontBytes, { subset: true });
  const imageBytes = await (await fetchAsset(artwork.getAttribute('src'))).arrayBuffer();
  const image = await pdf.embedPng(imageBytes);
  const page = pdf.addPage([pageWidth, pageHeight]);
  page.drawImage(image, { x: 0, y: 0, width: pageWidth, height: pageHeight });

  for (const field of fields) {
    const hex = field.color.slice(1);
    const [red, green, blue] = hex.match(/../g).map(channel => Number.parseInt(channel, 16) / 255);
    page.pushOperators(pushGraphicsState(),
      concatTransformationMatrix(field.stretch, 0, 0, 1, field.x, pageHeight - field.baseline));
    page.drawText(field.text, { x: 0, y: 0, font, size: field.size, color: rgb(red, green, blue) });
    page.pushOperators(popGraphicsState());
  }

  return pdf.save();
}

form.addEventListener('input', () => {
  nome.setCustomValidity('');
  entregue.setCustomValidity('');
  data.setCustomValidity('');
  updatePreview();
});

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (!diplomaFont || busy || !validate()) return;

  busy = true;
  baixar.disabled = true;
  status.textContent = 'Gerando o PDF…';
  try {
    const diploma = currentDiploma();
    const bytes = await createPdf(diploma);
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    const link = document.createElement('a');
    const filename = diploma.name.toLocaleLowerCase('pt-BR').replace(/[^\p{L}\p{M}\p{N}]+/gu, '-')
      .replace(/^-|-$/g, '');
    link.href = url;
    link.download = 'diploma-' + (filename || 'crianca') + '.pdf';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    status.textContent = '';
  } catch (error) {
    console.error(error);
    status.textContent = 'Não foi possível gerar o PDF. Tente novamente.';
  } finally {
    busy = false;
    baixar.disabled = false;
  }
});

imprimir.addEventListener('click', () => {
  if (diplomaFont && validate()) {
    updatePreview();
    window.print();
  }
});

async function initialize() {
  try {
    const [positions, bytes] = await Promise.all([
      fetchAsset('campos.json').then(response => response.json()),
      fetchAsset('fonts/Baloo2-ExtraBold.ttf').then(response => response.arrayBuffer()),
      document.fonts.load('800 16px "Baloo Diploma"'),
      ...[...artworks.values()].map(image => image.decode()),
    ]);
    campos = positions;
    fontBytes = bytes;
    diplomaFont = fontkit.create(new Uint8Array(bytes));
    updatePreview();
    status.textContent = '';
    baixar.disabled = false;
    imprimir.disabled = false;
  } catch (error) {
    console.error(error);
    status.textContent = 'Não foi possível carregar o diploma. Recarregue a página para tentar novamente.';
  }
}

initialize();
