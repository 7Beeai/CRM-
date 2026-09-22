# Handoff de design: CRM 7Bee (tela de Triagem)

> **Para o Claude Code:** este arquivo é a especificação completa. Aplique o novo visual no CRM existente **sem mudar comportamento, dados, rotas, textos de negócio nem o logo**. Leia tudo antes de editar.

## Arquivos deste pacote

| Arquivo | O que é |
|---|---|
| `tokens.css` | Todas as variáveis CSS (cores dos temas escuro e claro, espaçamento, raios, sombras, fontes). Fonte da verdade. |
| `tokens.json` | Os mesmos tokens em JSON (útil para gerar `tailwind.config` ou um tema JS). |
| `components.css` | Implementação de referência dos componentes em CSS puro (classes `sb-*`). |
| `reference/triagem.html` | A tela de Triagem inteira redesenhada. Abra no navegador (tem botão "Alternar tema"). |
| `reference/componentes.html` | Galeria de todos os componentes e estados. |

## Regras obrigatórias

1. **Não altere o logo.** Continua exatamente como está hoje: 🐝 seguido de "CRM 7Bee" em negrito. Não recolorir, não redesenhar, não trocar por ícone/SVG.
2. **Não mude lógica.** Filtros, ordenação, pontuação, ações ("Marcar respondida", "Descartar", "Prioridade", "Nota", feedback do agente), chamadas de API e estado continuam iguais. É uma mudança só de apresentação (markup/estilo); pequenas mudanças de estrutura de JSX/HTML são permitidas quando a spec pedir (ex.: avatar, chips de pontuação).
3. **Use tokens, nunca hex soltos.** Toda cor, espaçamento, raio e sombra vem de `var(--token)` (ou do mapeamento equivalente no Tailwind/tema). Se precisar de um valor que não existe, pare e pergunte.
4. **Dois temas.** Escuro é o padrão; claro via `data-theme="light"` no `<html>`. Se o CRM já tem preferência de tema, ligue-a a esse atributo; se não tem, deixe escuro e (opcional) adicione um toggle.
5. **Cor sempre acompanhada de texto ou seta.** Nunca comunicar estado só por cor.
6. Mantenha acessibilidade: foco visível (`outline: 2px solid var(--focus); outline-offset: 2px`) em todo controle; contrastes já validados nos tokens (≥4.5:1 para texto).

## Como aplicar (passo a passo)

1. **Descubra a stack** (React/Vue/HTML puro? Tailwind, CSS Modules, styled-components, shadcn?) e onde ficam os estilos globais e os componentes da Triagem.
2. **Instale os tokens**
   - CSS/CSS Modules/styled: importe `tokens.css` no CSS global.
   - Tailwind: importe `tokens.css` e estenda o `theme` apontando para as variáveis (ex.: `colors: { honey: 'var(--honey)', surface: 'var(--surface)', ink: { DEFAULT: 'var(--ink)', muted: 'var(--ink-muted)', subtle: 'var(--ink-subtle)' }, ... }`, `borderRadius: { sm: 'var(--radius-sm)', md: 'var(--radius-md)', lg: 'var(--radius-lg)' }`, `fontFamily: { display: 'var(--font-display)', sans: 'var(--font-sans)', mono: 'var(--font-mono)' }`).
3. **Fontes:** carregue do Google Fonts (ou `next/font`): Plus Jakarta Sans 400/500/600/700, Sora 600/700, JetBrains Mono 600. A primeira linha de `components.css` tem o `@import` pronto.
4. **Componentes:** se o projeto é HTML/CSS puro, pode usar `components.css` direto e trocar as classes. Se tem sistema de componentes próprio, **traduza** cada regra de `components.css` para ele, sem copiar classes `sb-*` desnecessariamente.
5. **Aplique na ordem:** TopNav → KPIs → Abas + barra de filtros → Card de mensagem (com painel do agente) → estados vazios/demais listas que usam os mesmos elementos.
6. **Verifique** abrindo o CRM lado a lado com `reference/triagem.html`, nos dois temas, em desktop e em ~390px de largura.

## De → Para (o que muda na tela atual)

| Hoje | Novo |
|---|---|
| Fundo grafite azulado (#0f1419-ish) | `--bg` grafite quente; cards em `--surface` com borda `--border` |
| Aba "Triagem de mensagens" com pílula marrom no topo | Link simples; ativo com sublinhado `--honey` de 2px (`aria-current="page"`) |
| KPIs em 5+1 (o "7.3h" sozinho na 2ª linha) | Grid `repeat(auto-fit, minmax(150px, 1fr))` → 6 na mesma linha; número em Sora 32px; só "Precisam de você" destacado (`--honey-soft` + número `--honey-text` + ponto mel); deltas opcionais verde/vermelho com seta |
| "7.3h" | "7,3h" (vírgula decimal pt-BR) |
| Abas de filtro soltas, ativa branca | Um trilho `--surface` com abas pílula; ativa em `--honey`/`--on-honey`; contador em mono |
| Barra de busca/filtros | Campos `--surface-sunken` com borda `--border-control`, raio `--radius-md`; botão "+ Registrar mensagem" primário mel à direita |
| Faixa vermelha na altura toda do card | Marca curta (3×28px) no topo da borda esquerda: vermelho alta, mel média, neutro baixa |
| Nome + "· empresa" em linha | Avatar com iniciais (36px, pílula) + nome em negrito + empresa em `--ink-muted` embaixo |
| "alta · 99" num chip só | Chip "ALTA" (`danger`) + pontuação "99" em mono separada |
| "whatsapp" | "WhatsApp · há 3 h" em `--ink-subtle` |
| Painel do agente marrom | `--honey-soft` quando escalou para humano; `--info-soft` (azul) quando o agente respondeu sozinho; confiança com barrinha verde + "93%" em mono; rascunho em `<details>` |
| "Por que priorizar: +30 … · +24 …" texto corrido | Cada fator vira um chip pílula com `+N` em `--success` |
| Botões iguais | Um primário mel ("Marcar respondida"); Prioridade/Nota secundários com ícone; Descartar em texto `--danger` (fundo só no hover) |
| "Acertou" / "Não precisava me chamar" | "Acertou" em `--success-soft`/`--success` pequeno; o outro como ghost |

## Significado das cores (não invente outros usos)

- **Mel (`--honey`)**: atenção humana necessária. Botão primário, aba ativa, KPI "Precisam de você", agente que escalou. No tema claro nunca como cor de texto (use `--honey-text`).
- **Verde (`--success`)**: positivo. Resolvido, acertou, KPI melhorou.
- **Vermelho (`--danger`)**: negativo/urgente. Prioridade alta, fora do prazo, risco de cancelamento, descartar, KPI piorou.
- **Azul (`--info`)**: o que o agente de IA fez sozinho.
- **Neutro**: descartadas, prioridade baixa.

Status → chip: Precisa de você = honey · Respondida pelo agente = info · Resolvida / Respondida por você = success · Fora do prazo = danger · Descartada = neutro.

## Critérios de aceite

- [ ] Logo idêntico ao atual.
- [ ] Nenhum hex novo fora de `tokens.css`.
- [ ] Tela de Triagem visualmente equivalente a `reference/triagem.html` nos temas escuro e claro.
- [ ] 6 KPIs numa linha em ≥1100px; quebram de forma equilibrada em telas menores; abas rolam na horizontal no mobile.
- [ ] Só um botão primário mel por card.
- [ ] Toda ação existente continua funcionando (teste cada botão e filtro).
- [ ] Foco visível navegando por Tab.

---

# Guia visual completo (referência)

Sistema visual do CRM da 7Bee: grafite quente com mel. A tela deve parecer calma quando está tudo em dia e apontar, em mel, só o que precisa de um humano.

## Princípios

- **Mel é atenção, não decoração.** `honey` aparece só onde há ação humana: o botão primário, a aba ativa, o KPI "Precisam de você" e o painel do agente quando ele escala. Se tudo é mel, nada é.
- **Cor tem significado fixo.** Verde `success` = positivo (resolvido, acertou, KPI melhorou). Vermelho `danger` = negativo/urgente (alta prioridade, fora do prazo, risco de cancelamento, descartar). Azul `info` = o que o agente de IA fez sozinho — é o complementar do mel e passa confiança técnica. Neutro = arquivado, sem carga.
- **Toda cor vem com palavra.** Chip, delta de KPI e prioridade sempre têm texto ou seta; nunca só a cor.
- **Um primário por card.** "Marcar respondida" é mel; o resto é secundário, ghost ou perigo discreto.

## Conteúdo e tom

Português do Brasil, direto, na segunda pessoa: "Precisam de você", "Rascunho sugerido para você", "O agente acertou?". Rótulos de botão são verbos no infinitivo ou particípio curto ("Marcar respondida", "Descartar"). Números com vírgula decimal ("7,3h"). Sem emoji na interface — a única exceção é o logo.

## Cores

- Fundo da página `bg`; cards e barra `surface`; hover e botões secundários `surface-raised`; campos `surface-sunken`.
- Texto `ink` (principal), `ink-muted` (empresa, legendas, motivo), `ink-subtle` (canal, tempo, placeholder — só sobre `bg`, `surface`, `surface-raised`).
- Linhas `border` (decorativas); contorno de controles `border-control` (≥3:1).
- Mel: preenchimento `honey` com texto `on-honey`; hover `honey-strong`; fundo suave `honey-soft`; texto cor de mel `honey-text`. No tema claro `honey` nunca é texto.
- Estados: `success`/`success-soft`, `danger`/`danger-soft`, `info`/`info-soft` — o `-soft` é fundo, a cor cheia é texto/ícone sobre ele.
- Tema escuro é o principal; o claro espelha cada token. Todo par de texto listado passa 4.5:1 nos dois temas.

## Tipografia

- `Sora` (display) só para números de KPI (`kpi`) e título de página (`title`).
- `Plus Jakarta Sans` para toda a interface: `heading` (nome do contato), `body` (mensagem), `label` (botões, abas), `caption` (metadados), `overline` (chips em maiúsculas).
- `JetBrains Mono` para dados comparáveis: pontuação, confiança, contadores de aba (`score`).

## Espaço, raios e sombras

- Escala de 4px: `space-1`…`space-8`. Card de mensagem com padding `space-5`, KPI com `space-4`, `space-3` entre cards, `space-6` entre seções.
- Raios: `radius-sm` chips, `radius-md` botões e campos, `radius-lg` cards, `radius-pill` abas e avatar.
- Sombra só em hover de card (`shadow-card`) e no botão primário (`shadow-honey`). No resto, bordas finas.
- Foco: anel sólido de 2px em `focus` com 2px de afastamento, em todo controle.

## Iconografia

Ícones de traço 2px, 16px, cantos arredondados, cor `currentColor` (estilo Lucide), sempre ao lado de um rótulo. O agente é representado por um ícone de robô simples em `honey-text` (escalou) ou `info` (resolveu).

## Marca

O logo da 7Bee não faz parte do redesenho: use-o exatamente como está no CRM (🐝 seguido de "CRM 7Bee" em negrito, `sb-brand`). Não recolorir, redesenhar nem trocar por outro símbolo; as cores do sistema giram em torno dele, não o contrário.


## Componentes

### TopNav

Barra superior do CRM: marca à esquerda, seções no meio, ações e avatar à direita.

- A seção ativa leva `aria-current="page"` e ganha um sublinhado `honey` de 2px — substitui o antigo "botão marrom" na aba ativa.
- O logo à esquerda é o da 7Bee, sem alterações (🐝 + "CRM 7Bee"). Não redesenhe nem recolora.


### Stat

Card de KPI do topo da triagem: número grande (`kpi`, fonte display) sobre a legenda (`caption`, `ink-muted`).

- Envolva os cards em `sb-stats` (grid automático, mínimo 150px — todos na mesma linha em desktop, sem card órfão).
- Só o KPI que exige ação ("Precisam de você") usa `sb-stat--attention`: fundo `honey-soft`, número `honey-text` e ponto mel. Os demais ficam neutros.
- `sb-stat__delta` opcional: `is-up` (verde, melhorou) ou `is-down` (vermelho, piorou) — sempre com seta e texto, a cor nunca sozinha. "Melhorou" depende da métrica: tempo de resposta caindo é `is-up`.


### Tabs

Filtros da fila num único trilho (`sb-tabs`) com abas pílula (`sb-tab`) e contador opcional (`sb-tab__count`, mono).

- A aba ativa leva `aria-selected="true"` e fica em `honey` com texto `on-honey` — é o único bloco mel grande da barra.
- Abaixo, a barra de ferramentas `sb-toolbar`: busca `sb-field sb-field--grow`, selects `sb-field` e o botão primário à direita.
- Em telas estreitas o trilho rola na horizontal; não quebre as abas em duas linhas.


### Button

Botão de ação; um único `sb-btn--primary` (mel) por card ou por tela.

- **Primário** `sb-btn sb-btn--primary` — a ação que fecha o item ("Marcar respondida", "+ Registrar mensagem"). Fundo `honey`, texto `on-honey`, sombra `shadow-honey`.
- **Secundário** `sb-btn` — ações neutras (Prioridade, Nota). Fundo `surface-raised`, borda `border-control`.
- **Perigo** `sb-btn--danger` — Descartar: texto `danger`, fundo `danger-soft` só no hover (ação negativa não grita em repouso).
- **Positivo** `sb-btn--success` — feedback "Acertou". **Ghost** `sb-btn--ghost` — ações de barra (Atualizar).
- `sb-btn--sm` (30px) para feedback do agente e linhas densas.

O consumidor fornece o rótulo e, opcionalmente, um ícone SVG 16px antes do texto (stroke `currentColor`, 2px). Não coloque dois primários lado a lado.


### Badge

Chip curto que diz o estado ou a prioridade de uma mensagem, sempre com palavra (nunca só cor).

| Estado | Classe | Por quê |
|---|---|---|
| Precisa de você | `sb-badge--honey` | Mel = atenção da marca, pede ação humana |
| Respondida pelo agente | `sb-badge--info` | Azul = automação/IA |
| Resolvida / respondida por você | `sb-badge--success` | Verde = positivo |
| Fora do prazo, prioridade alta, risco de churn | `sb-badge--danger` | Vermelho = negativo/urgente |
| Descartada, baixa | `sb-badge` (neutro) | Sem carga emocional |

Prioridade usa `sb-badge--plain` (sem ponto). A pontuação de relevância vai em `sb-score` (mono); ≥80 usa `sb-score--high`.


### AgentPanel

Bloco dentro do card de mensagem que mostra o que o agente de IA decidiu, por quê, com que confiança e o rascunho.

- `sb-agent--escalated` (fundo `honey-soft`): o agente passou a bola para um humano — combina com o estado "Precisa de você".
- `sb-agent--resolved` (fundo `info-soft`): o agente respondeu sozinho — azul = automação.
- Confiança: barra `sb-conf` em `success` + número em `sb-score`. O rascunho fica recolhido num `<details>`.
- O consumidor fornece: nome do agente, decisão, categoria, confiança (0–100), motivo e texto do rascunho.


### MessageCard

Card de uma mensagem na fila de triagem: quem, o quê, o que o agente fez, por que priorizar e o que fazer agora.

Ordem fixa, de cima para baixo: cabeçalho (avatar, nome `heading`, empresa `ink-muted`, prioridade + pontuação + status + canal/tempo) → texto (`body`) → `AgentPanel` → `sb-why` (os pontos somados, `+N` em verde) → ações → feedback do agente.

- A régua de prioridade `sb-msg__prio` na borda esquerda é curta (28px), não uma faixa de altura total: `danger` alta, `--mid` mel, `--low` neutra.
- Um só primário ("Marcar respondida"). Responsável alinhado à direita em `ink-subtle`.
- O consumidor fornece: contato, empresa, prioridade, pontuação, status, canal, tempo, texto, dados do agente, fatores de pontuação e responsável.


### TriagemPage

A tela de triagem inteira montada com o sistema: TopNav, KPIs (Stat), filtros (Tabs + toolbar) e a fila de MessageCard.

Largura máxima de conteúdo 1120px, margem lateral `space-8` (desktop) / `space-4` (mobile), `space-6` entre blocos e `space-3` entre cards.
