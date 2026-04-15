let imgElement = document.getElementById('preview');
let inputElement = document.getElementById('camera');

inputElement.onchange = function () {
  let file = inputElement.files[0];
  imgElement.src = URL.createObjectURL(file);
};

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

  if (!imgElement.src) {
    status.innerText = "❌ Selecione uma imagem.";
    return;
  }

  let src = cv.imread(imgElement);

  let gray = new cv.Mat();
  cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

  let width = 800;
  let scale = width / src.cols;
  let height = parseInt(src.rows * scale);

  let resized = new cv.Mat();
  cv.resize(gray, resized, new cv.Size(width, height));

  let blur = new cv.Mat();
  cv.GaussianBlur(resized, blur, new cv.Size(5,5), 0);

  let thresh = new cv.Mat();
  cv.threshold(blur, thresh, 120, 255, cv.THRESH_BINARY_INV);

  let squares = detectarQuadrados(thresh);
  let warped;

  if (squares.length >= 4) {
    let pts = ordenar4Quadrados(squares);
    warped = aplicarWarp(resized, pts);
  } else {
    let pts = detectarFolha(resized);
    if (!pts) {
      status.innerText = "❌ Não foi possível detectar a folha.";
      return;
    }
    warped = aplicarWarp(resized, pts);
  }

  if (!validarOrientacao(warped)) {
    cv.rotate(warped, warped, cv.ROTATE_180);
  }

  let final = new cv.Mat();
  cv.threshold(warped, final, 120, 255, cv.THRESH_BINARY_INV);

  let respostas = lerRespostas(final);

  let gabarito = document.getElementById("gabarito")
    .value.split("\n")
    .map(l => l.trim().toUpperCase())
    .filter(l => l);

  if (gabarito.length !== 35) {
    status.innerText = "❌ Gabarito precisa de 35 linhas.";
    return;
  }

  let materias = lerMaterias();
  let erro = validarMaterias(materias);

  if (erro) {
    status.innerText = "❌ " + erro;
    return;
  }

  let resultado = corrigir(respostas, gabarito);
  let porMateria = calcularPorMateria(respostas, gabarito, materias);

  mostrarResultado(resultado, porMateria);

  cv.imshow('canvas', final);
}

// =========================
// LEITURA DAS RESPOSTAS
// =========================
function lerRespostas(img) {
  let respostas = [];

  let h = img.rows;
  let w = img.cols;

  let top = parseInt(h * 0.55);
  let bottom = parseInt(h * 0.95);
  let left = parseInt(w * 0.05);
  let right = parseInt(w * 0.95);

  let area = img.roi(new cv.Rect(left, top, right-left, bottom-top));

  let colWidth = area.cols / 3;

  let config = [
    {start:0, end:15},
    {start:15, end:30},
    {start:30, end:35}
  ];

  let letras = ["A","B","C","D","E"];

  config.forEach((col, cIndex) => {
    let xStart = parseInt(cIndex * colWidth);
    let rows = col.end - col.start;
    let rowHeight = area.rows / rows;

    for (let i = 0; i < rows; i++) {
      let y = parseInt(i * rowHeight);

      let scores = [];

      for (let j = 0; j < 5; j++) {
        let x = parseInt(xStart + j * (colWidth / 5));
        let box = area.roi(new cv.Rect(x, y, colWidth/5, rowHeight));
        let mean = cv.mean(box)[0];
        scores.push(mean);
      }

      let minIndex = scores.indexOf(Math.min(...scores));
      respostas.push(letras[minIndex]);
    }
  });

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
      questao: i+1,
      aluno: r,
      correto: gabarito[i],
      acerto: certo
    };
  });

  return {acertos, detalhes};
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
    texto += `Q${d.questao}: ${d.aluno} | ${d.correto} ${d.acerto ? "✅" : "❌"}\n`;
  });

  div.innerText = texto;
}

// =========================
// VISÃO COMPUTACIONAL
// =========================
function detectarQuadrados(thresh) {
  let contours = new cv.MatVector();
  let hierarchy = new cv.Mat();

  cv.findContours(thresh, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

  let squares = [];

  for (let i = 0; i < contours.size(); i++) {
    let cnt = contours.get(i);
    let area = cv.contourArea(cnt);

    if (area < 500 || area > 5000) continue;

    let peri = cv.arcLength(cnt, true);
    let approx = new cv.Mat();
    cv.approxPolyDP(cnt, approx, 0.02 * peri, true);

    if (approx.rows === 4) {
      let rect = cv.boundingRect(approx);
      let ratio = rect.width / rect.height;

      if (ratio > 0.8 && ratio < 1.2) {
        squares.push({
          x: rect.x + rect.width/2,
          y: rect.y + rect.height/2
        });
      }
    }
  }

  return squares;
}

function ordenar4Quadrados(pts) {
  pts.sort((a, b) => a.y - b.y);

  let top = pts.slice(0,2).sort((a,b)=>a.x-b.x);
  let bottom = pts.slice(2,4).sort((a,b)=>a.x-b.x);

  return [top[0], top[1], bottom[0], bottom[1]];
}

function detectarFolha(img) {
  let edges = new cv.Mat();
  cv.Canny(img, edges, 75, 200);

  let contours = new cv.MatVector();
  let hierarchy = new cv.Mat();

  cv.findContours(edges, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

  let maxArea = 0;
  let best = null;

  for (let i = 0; i < contours.size(); i++) {
    let cnt = contours.get(i);
    let area = cv.contourArea(cnt);

    if (area > 50000) {
      let peri = cv.arcLength(cnt, true);
      let approx = new cv.Mat();
      cv.approxPolyDP(cnt, approx, 0.02 * peri, true);

      if (approx.rows === 4 && area > maxArea) {
        maxArea = area;
        best = approx;
      }
    }
  }

  if (!best) return null;

  let pts = [];
  for (let i = 0; i < 4; i++) {
    pts.push({
      x: best.intPtr(i, 0)[0],
      y: best.intPtr(i, 0)[1]
    });
  }

  return ordenar4Quadrados(pts);
}

function aplicarWarp(img, pts) {
  let dst = new cv.Mat();
  let size = new cv.Size(600, 900);

  let srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
    pts[0].x, pts[0].y,
    pts[1].x, pts[1].y,
    pts[2].x, pts[2].y,
    pts[3].x, pts[3].y
  ]);

  let dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
    0, 0,
    600, 0,
    0, 900,
    600, 900
  ]);

  let M = cv.getPerspectiveTransform(srcTri, dstTri);
  cv.warpPerspective(img, dst, M, size);

  return dst;
}

function validarOrientacao(img) {
  let h = img.rows;
  let w = img.cols;

  let bottom = img.roi(new cv.Rect(0, h-100, w, 100));
  let top = img.roi(new cv.Rect(0, 0, w, 100));

  return cv.mean(bottom)[0] < cv.mean(top)[0];
}