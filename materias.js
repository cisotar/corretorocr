// =========================
// CONFIGURAÇÃO DAS MATÉRIAS
// =========================
// Formato: nome da matéria, questão inicial-questão final
// O total de questões deve somar exatamente 35 (questões 1 a 35)
//
// Exemplo:
//   matematica, 01-10
//   fisica, 11-20

const MATERIAS_CONFIG = `
matematica, 01-10
fisica, 11-20
quimica, 21-30
biologia, 31-35
`.trim();

// Faz o parse das matérias e popula a interface ao carregar
function carregarMaterias() {
  const linhas = MATERIAS_CONFIG.split("\n").map(l => l.trim()).filter(l => l && !l.startsWith("//"));
  const container = document.getElementById("materias");
  container.innerHTML = "";

  for (const linha of linhas) {
    const partes = linha.split(",").map(p => p.trim());
    if (partes.length !== 2) continue;

    const nome = partes[0];
    const intervalo = partes[1].split("-").map(n => parseInt(n.trim()));
    if (intervalo.length !== 2 || isNaN(intervalo[0]) || isNaN(intervalo[1])) continue;

    const bloco = document.createElement("div");
    bloco.className = "materia";
    bloco.innerHTML = `
      <input placeholder="Nome (ex: Matemática)" value="${nome}">
      <input type="number" placeholder="Início" value="${intervalo[0]}">
      <input type="number" placeholder="Fim" value="${intervalo[1]}">
    `;
    container.appendChild(bloco);
  }
}
