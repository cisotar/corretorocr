let imgElement = document.getElementById('preview');
let inputElement = document.getElementById('camera');
let uploadArea = document.getElementById('upload-area');
let nomeArquivo = document.getElementById('nome-arquivo');

// Carrega matérias do arquivo materias.js ao iniciar
document.addEventListener("DOMContentLoaded", function () {
  if (typeof carregarMaterias === "function") carregarMaterias();
});

// Seleção via input file (câmera ou galeria)
inputElement.onchange = function () {
  let file = inputElement.files[0];
  if (file) carregarImagem(file);
};

// Drag and drop sobre a área de upload
uploadArea.addEventListener('dragover', function (e) {
  e.preventDefault();
  uploadArea.classList.add('drag-over');
});

uploadArea.addEventListener('dragleave', function () {
  uploadArea.classList.remove('drag-over');
});

uploadArea.addEventListener('drop', function (e) {
  e.preventDefault();
  uploadArea.classList.remove('drag-over');
  let file = e.dataTransfer.files[0];
  if (file && file.type.startsWith('image/')) {
    carregarImagem(file);
  } else {
    document.getElementById('status').innerText = '❌ Arquivo inválido. Envie uma imagem.';
  }
});

function carregarImagem(file) {
  imgElement.src = URL.createObjectURL(file);
  nomeArquivo.innerText = '✅ ' + file.name;
}

// =========================
// MATÉRIAS
// =========================
function addMateria() {
  const div = document.getElementById("materias");

  const bloco = document.createElement("div");
  bloco.className = "materia";

  bloco.innerHTML = `
    <input placeholder="Nome (ex: Matemática)">
    <input type="number" placeholder="Início">
    <input type="number" placeholder="Fim">
  `;

  div.appendChild(bloco);
}

function lerMaterias() {
  const blocos = document.getElementById("materias").children;
  let materias = [];

  for (let b of blocos) {
    let inputs = b.getElementsByTagName("input");

    let nome = inputs[0].value;
    let inicio = parseInt(inputs[1].value);
    let fim = parseInt(inputs[2].value);

    if (!nome || isNaN(inicio) || isNaN(fim)) continue;

    materias.push({ nome, inicio, fim });
  }

  return materias;
}

function validarMaterias(materias) {
  let mapa = Array(36).fill(0);

  for (let m of materias) {
    if (m.inicio < 1 || m.fim > 35 || m.inicio > m.fim) {
      return "Intervalo inválido em " + m.nome;
    }

    for (let i = m.inicio; i <= m.fim; i++) {
      if (mapa[i]) return "Sobreposição na questão " + i;
      mapa[i] = 1;
    }
  }

  for (let i = 1; i <= 35; i++) {
    if (!mapa[i]) return "Questão " + i + " não atribuída";
  }

  return null;
}

// =========================
// MAIN
// =========================
function processar() {
  let status = document.getElementById("status");

  if (!imgElement.src || imgElement.naturalWidth === 0) {
    status.innerText = "❌ Selecione uma imagem.";
    return;
  }

  status.innerText = "⏳ Processando...";

  // Pequeno delay para o texto aparecer antes do processamento pesado
  setTimeout(() => {
    try {
      _processarImagem(status);
    } catch (e) {
      status.innerText = "❌ Erro ao processar: " + e.message;
      console.error(e);
    }
  }, 50);
}

function _processarImagem(status) {
  let src = cv.imread(imgElement);

  // Redimensiona para largura padrão mantendo proporção
  let WIDTH = 900;
  let scale = WIDTH / src.cols;
  let HEIGHT = parseInt(src.rows * scale);

  let resized = new cv.Mat();
  cv.resize(src, resized, new cv.Size(WIDTH, HEIGHT));
  src.delete();

  // Converte para cinza
  let gray = new cv.Mat();
  cv.cvtColor(resized, gray, cv.COLOR_RGBA2GRAY);

  // Tenta detectar e alinhar a folha
  let warped = detectarEAlinharFolha(gray, resized);

  resized.delete();
  gray.delete();

  if (!warped) {
    status.innerText = "❌ Não foi possível detectar a folha.\nDica: enquadre bem a folha com fundo contrastante.";
    return;
  }

  // Valida e corrige orientação (fundo escuro no rodapé = correto)
  if (!validarOrientacao(warped)) {
    cv.rotate(warped, warped, cv.ROTATE_180);
  }

  // Threshold para leitura das bolinhas
  let warpedGray = new cv.Mat();
  if (warped.channels() > 1) {
    cv.cvtColor(warped, warpedGray, cv.COLOR_RGBA2GRAY);
  } else {
    warped.copyTo(warpedGray);
  }

  let final = new cv.Mat();
  cv.adaptiveThreshold(warpedGray, final, 255,
    cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY_INV, 25, 10);

  warpedGray.delete();

  let respostas = lerRespostas(final);

  let gabarito = document.getElementById("gabarito")
    .value.split("\n")
    .map(l => l.trim().toUpperCase())
    .filter(l => l);

  if (gabarito.length !== 35) {
    status.innerText = "❌ Gabarito precisa de 35 linhas (tem " + gabarito.length + ").";
    warped.delete();
    final.delete();
    return;
  }

  let materias = lerMaterias();
  let erro = validarMaterias(materias);

  if (erro) {
    status.innerText = "❌ " + erro;
    warped.delete();
    final.delete();
    return;
  }

  let resultado = corrigir(respostas, gabarito);
  let porMateria = calcularPorMateria(respostas, gabarito, materias);

  mostrarResultado(resultado, porMateria);

  cv.imshow('canvas', final);

  warped.delete();
  final.delete();
}

// =========================
// DETECÇÃO E ALINHAMENTO DA FOLHA
// =========================

/**
 * Tenta múltiplas estratégias para encontrar e alinhar a folha de gabarito.
 * Retorna Mat cinza 600x900 alinhado, ou null se falhar.
 */
function detectarEAlinharFolha(gray, colorSrc) {
  // Estratégia 1: marcadores de canto (quadrados sólidos pretos nos extremos)
  let pts = detectarMarcadoresCanto(gray);

  // Estratégia 2: maior retângulo da folha por Canny
  if (!pts) {
    pts = detectarRetanguloFolha(gray);
  }

  // Estratégia 3: usar a imagem inteira como fallback (sem warp)
  if (!pts) {
    let h = gray.rows, w = gray.cols;
    let margem = parseInt(Math.min(w, h) * 0.02);
    pts = [
      { x: margem,     y: margem },
      { x: w - margem, y: margem },
      { x: margem,     y: h - margem },
      { x: w - margem, y: h - margem }
    ];
  }

  return aplicarWarp(gray, pts);
}

/**
 * Detecta os 4 marcadores quadrados pretos nos cantos da folha Prova Paulista.
 * São quadrados sólidos (~1cm) situados nos 4 extremos da folha.
 */
function detectarMarcadoresCanto(gray) {
  let blur = new cv.Mat();
  cv.GaussianBlur(gray, blur, new cv.Size(5, 5), 0);

  let thresh = new cv.Mat();
  cv.threshold(blur, thresh, 0, 255, cv.THRESH_BINARY_INV + cv.THRESH_OTSU);
  blur.delete();

  let contours = new cv.MatVector();
  let hierarchy = new cv.Mat();
  cv.findContours(thresh, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
  thresh.delete();
  hierarchy.delete();

  let W = gray.cols, H = gray.rows;
  // Marcadores são quadrados pequenos nos cantos — área entre 0.05% e 1% da imagem
  let areaMin = W * H * 0.0005;
  let areaMax = W * H * 0.01;

  let candidatos = [];

  for (let i = 0; i < contours.size(); i++) {
    let cnt = contours.get(i);
    let area = cv.contourArea(cnt);

    if (area < areaMin || area > areaMax) { cnt.delete(); continue; }

    let rect = cv.boundingRect(cnt);
    let ratio = rect.width / rect.height;

    // Deve ser aproximadamente quadrado
    if (ratio < 0.5 || ratio > 2.0) { cnt.delete(); continue; }

    // Deve estar nos 20% de borda da imagem (canto)
    let cx = rect.x + rect.width / 2;
    let cy = rect.y + rect.height / 2;

    let naBorda = (cx < W * 0.2 || cx > W * 0.8) && (cy < H * 0.2 || cy > H * 0.8);
    if (!naBorda) { cnt.delete(); continue; }

    candidatos.push({ x: cx, y: cy, area });
    cnt.delete();
  }

  contours.delete();

  if (candidatos.length < 4) return null;

  // Se tiver mais de 4, pega os 4 mais extremos (um por canto)
  let tl = candidatos.reduce((best, p) => (p.x + p.y < best.x + best.y ? p : best));
  let tr = candidatos.reduce((best, p) => ((W - p.x) + p.y < (W - best.x) + best.y ? p : best));
  let bl = candidatos.reduce((best, p) => (p.x + (H - p.y) < best.x + (H - best.y) ? p : best));
  let br = candidatos.reduce((best, p) => ((W - p.x) + (H - p.y) < (W - best.x) + (H - best.y) ? p : best));

  // Verifica se os 4 pontos são distintos
  let unicos = new Set([tl, tr, bl, br]);
  if (unicos.size < 4) return null;

  return [tl, tr, bl, br];
}

/**
 * Detecta o maior retângulo da folha usando Canny + contornos.
 * Funciona bem quando a folha tem borda escura visível.
 */
function detectarRetanguloFolha(gray) {
  let blur = new cv.Mat();
  cv.GaussianBlur(gray, blur, new cv.Size(7, 7), 0);

  // Canny adaptativo baseado na mediana da imagem
  let edges = new cv.Mat();
  cv.Canny(blur, edges, 50, 150);
  blur.delete();

  // Dilata um pouco para fechar bordas quebradas
  let kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3));
  cv.dilate(edges, edges, kernel);
  kernel.delete();

  let contours = new cv.MatVector();
  let hierarchy = new cv.Mat();
  cv.findContours(edges, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
  edges.delete();
  hierarchy.delete();

  let W = gray.cols, H = gray.rows;
  let areaMin = W * H * 0.3; // A folha deve ocupar ao menos 30% da imagem

  let maxArea = 0;
  let best = null;

  for (let i = 0; i < contours.size(); i++) {
    let cnt = contours.get(i);
    let area = cv.contourArea(cnt);

    if (area > areaMin) {
      let peri = cv.arcLength(cnt, true);
      let approx = new cv.Mat();
      // Tolerância maior (4%) para folhas levemente dobradas/distorcidas
      cv.approxPolyDP(cnt, approx, 0.04 * peri, true);

      if (approx.rows === 4 && area > maxArea) {
        maxArea = area;
        if (best) best.delete();
        best = approx;
      } else {
        approx.delete();
      }
    }
    cnt.delete();
  }

  contours.delete();

  if (!best) return null;

  let pts = [];
  for (let i = 0; i < 4; i++) {
    pts.push({
      x: best.intPtr(i, 0)[0],
      y: best.intPtr(i, 0)[1]
    });
  }
  best.delete();

  return ordenar4Pontos(pts);
}

/**
 * Ordena 4 pontos na ordem: [topo-esq, topo-dir, baixo-esq, baixo-dir]
 */
function ordenar4Pontos(pts) {
  // Soma menor = topo-esq, soma maior = baixo-dir
  // Diferença menor = topo-dir, diferença maior = baixo-esq
  let soma = pts.map(p => p.x + p.y);
  let diff = pts.map(p => p.y - p.x);

  let tl = pts[soma.indexOf(Math.min(...soma))];
  let br = pts[soma.indexOf(Math.max(...soma))];
  let tr = pts[diff.indexOf(Math.min(...diff))];
  let bl = pts[diff.indexOf(Math.max(...diff))];

  return [tl, tr, bl, br];
}

function aplicarWarp(img, pts) {
  // Proporção A4 ≈ 1:√2, usamos 620×877
  let W_OUT = 620, H_OUT = 877;
  let dst = new cv.Mat();
  let size = new cv.Size(W_OUT, H_OUT);

  let srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
    pts[0].x, pts[0].y,  // topo-esq
    pts[1].x, pts[1].y,  // topo-dir
    pts[2].x, pts[2].y,  // baixo-esq
    pts[3].x, pts[3].y   // baixo-dir
  ]);

  let dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
    0,     0,
    W_OUT, 0,
    0,     H_OUT,
    W_OUT, H_OUT
  ]);

  let M = cv.getPerspectiveTransform(srcTri, dstTri);
  cv.warpPerspective(img, dst, M, size);

  srcTri.delete();
  dstTri.delete();
  M.delete();

  return dst;
}

function validarOrientacao(img) {
  let h = img.rows, w = img.cols;
  // Na Prova Paulista o rodapé tem fundo mais escuro (barra preta inferior)
  let bottom = img.roi(new cv.Rect(0, h - 80, w, 80));
  let top    = img.roi(new cv.Rect(0, 0,      w, 80));
  let correto = cv.mean(bottom)[0] < cv.mean(top)[0];
  bottom.delete();
  top.delete();
  return correto;
}

// =========================
// LEITURA DAS RESPOSTAS
// =========================

/**
 * Lê as respostas da área de gabarito da Prova Paulista.
 *
 * Layout após warp (620×877):
 *   - Seção "Respostas" começa em ~63% da altura
 *   - 3 colunas: Q1-15 | Q16-30 | Q31-35
 *   - Cada coluna tem: número da questão + 5 círculos (A B C D E)
 *   - Os círculos ocupam ~80% da largura da coluna (lado direito)
 */
function lerRespostas(img) {
  let respostas = [];
  let letras = ["A", "B", "C", "D", "E"];

  let H = img.rows;
  let W = img.cols;

  // Região das respostas: de 63% a 99% da altura
  let yTop    = parseInt(H * 0.63);
  let yBottom = parseInt(H * 0.99);
  let xLeft   = parseInt(W * 0.02);
  let xRight  = parseInt(W * 0.98);

  let areaH = yBottom - yTop;
  let areaW = xRight - xLeft;

  // Divide em 3 colunas iguais
  let colW = areaW / 3;

  // Coluna 1: Q1-15 (15 linhas), Coluna 2: Q16-30 (15 linhas), Coluna 3: Q31-35 (5 linhas)
  let colunas = [
    { xOff: 0,        numQ: 15 },
    { xOff: colW,     numQ: 15 },
    { xOff: colW * 2, numQ: 5  }
  ];

  for (let col of colunas) {
    let rowH = areaH / col.numQ;

    // Círculos ficam nos ~70% direitos de cada coluna (o número da questão fica à esquerda)
    let circXStart = col.xOff + colW * 0.28;
    let circW      = colW * 0.70;
    let circW5     = circW / 5;  // largura de cada círculo

    for (let q = 0; q < col.numQ; q++) {
      let y = parseInt(yTop + q * rowH);
      let scores = [];

      for (let j = 0; j < 5; j++) {
        let x = parseInt(xLeft + circXStart + j * circW5);
        // Garante que o ROI não ultrapassa a imagem
        let bw = Math.min(parseInt(circW5), W - x - 1);
        let bh = Math.min(parseInt(rowH * 0.85), H - y - 1);

        if (bw <= 0 || bh <= 0) { scores.push(0); continue; }

        let box = img.roi(new cv.Rect(x, y, bw, bh));
        scores.push(cv.mean(box)[0]);
        box.delete();
      }

      // Menor média = mais escuro = bolinha marcada
      let minVal = Math.min(...scores);
      // Só considera marcado se a diferença for significativa (evita ruído)
      let maxVal = Math.max(...scores);
      if (maxVal - minVal < 8) {
        respostas.push("?"); // ambíguo / em branco
      } else {
        respostas.push(letras[scores.indexOf(minVal)]);
      }
    }
  }

  return respostas;
}

// =========================
// CORREÇÃO
// =========================
function corrigir(aluno, gabarito) {
  let acertos = 0;

  let detalhes = aluno.map((r, i) => {
    let certo = r === gabarito[i];
    if (certo) acertos++;

    return {
      questao: i + 1,
      aluno: r,
      correto: gabarito[i],
      acerto: certo
    };
  });

  return { acertos, detalhes };
}

// =========================
// POR MATÉRIA
// =========================
function calcularPorMateria(respostas, gabarito, materias) {
  let resultado = [];

  for (let m of materias) {
    let acertos = 0;
    let total = m.fim - m.inicio + 1;

    for (let i = m.inicio - 1; i < m.fim; i++) {
      if (respostas[i] === gabarito[i]) acertos++;
    }

    let nota = (acertos / total) * 10;

    resultado.push({
      nome: m.nome,
      acertos,
      total,
      nota: nota.toFixed(2)
    });
  }

  return resultado;
}

// =========================
// EXIBIÇÃO
// =========================
function mostrarResultado(res, materias) {
  let div = document.getElementById("status");

  let texto = `🎯 TOTAL: ${res.acertos}/35\n\n`;

  texto += "📊 POR MATÉRIA:\n";
  materias.forEach(m => {
    texto += `${m.nome}: ${m.acertos}/${m.total} → Nota ${m.nota}\n`;
  });

  texto += "\n📋 DETALHES:\n";
  res.detalhes.forEach(d => {
    let marca = d.acerto ? "✅" : (d.aluno === "?" ? "⬜" : "❌");
    texto += `Q${String(d.questao).padStart(2,'0')}: ${d.aluno} | gabarito: ${d.correto} ${marca}\n`;
  });

  div.innerText = texto;
}
