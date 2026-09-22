# CRM 7Bee

CRM interno enxuto para a operação. O agente de atendimento faz a primeira
triagem: responde sozinho o que consegue resolver e escala para o CS (Guilherme)
só o que precisa de gente. O CRM é o painel de controle disso, e também pontua
cada mensagem por conta própria, para que a fila humana venha na ordem certa.

Roda com **zero dependências** — só Node.js 22.5 ou superior (usa o SQLite nativo).

## Como rodar

```bash
npm run seed    # opcional: cria dados de exemplo na primeira vez
npm start       # http://localhost:3000
```

O banco fica em `data/crm.db` (arquivo SQLite, fora do Git). Para fazer backup,
basta copiar esse arquivo.

Variáveis de ambiente:

| Variável | Para quê | Padrão |
| --- | --- | --- |
| `PORT` | porta do servidor | `3000` |
| `CRM_DB` | caminho do banco | `data/crm.db` |
| `CRM_TOKEN` | exige token nas chamadas do agente | vazio (sem token) |
| `CRM_AGENT_TIMEOUT_MIN` | minutos até avisar que o agente não decidiu | `10` |
| `CRM_ESCALATION_WEBHOOK` | URL avisada a cada escalonamento | vazio (não avisa) |
| `CRM_ONBOARDING_ALERTA_DIAS` | dias parado até sinalizar a franquia | `7` |

## As abas

**Triagem de mensagens** é o coração do CRM, e já abre na fila do que o agente
escalou. Cada card mostra a decisão do agente, a confiança, o motivo e, quando
existe, o rascunho de resposta ou o texto que ele já mandou ao cliente. O CS
responde, descarta ou traz de volta uma mensagem, e avalia se o agente acertou.
As outras abas da fila separam o que está aguardando o agente, o que ele
respondeu sozinho e o que já foi resolvido.

Além da decisão do agente, o CRM pontua cada mensagem de 0 a 100 e explica *por
que* ela subiu ou desceu na fila, então mesmo que o agente fique fora do ar a
ordem continua fazendo sentido.

**Onboarding** é a esteira de implantação das franquias. Cada franquia é um card
que anda pelas colunas, e as colunas são as tarefas: cadastro na OpenAI, criação
de BM no Facebook, CTN e teste do agente de vendas. Dá para arrastar o card ou
marcar as tarefas no detalhe, que as duas coisas se mantêm em acordo. Franquias
paradas há muitos dias ou com tarefa travada ficam sinalizadas.

Franquias entram na esteira pelo botão **Nova franquia** ou sozinhas, quando um
grupo novo aparece no WhatsApp do CS. Essa entrada automática depende do provedor
de WhatsApp que vocês forem usar, e o caminho está explicado em
[`docs/ONBOARDING.md`](docs/ONBOARDING.md).

**Contatos** guarda quem é quem: empresa, canais, etapa no funil, responsável e
observações. Marcar alguém como cliente ativo faz as mensagens dessa pessoa
subirem na triagem automaticamente.

**Painel** reúne os números do período: quanto o agente resolve sem humano, o que
ele fez com cada mensagem, como o time avaliou essas decisões, o volume por canal
e a distribuição do funil.

## Como a relevância é calculada

O motor fica em `server/relevance.js` e soma sinais do texto, do canal e do
histórico do contato:

| Sinal | Pontos |
| --- | --- |
| Intenção de compra (orçamento, contrato, fechar) | +30 |
| Risco de churn (cancelar, reembolso, reclamação) | +28 |
| Problema técnico (erro, fora do ar, travou) | +24 |
| Urgência declarada (urgente, hoje, prazo) | +20 |
| Financeiro (boleto, nota fiscal, cobrança) | +16 |
| Pergunta direta | +12 |
| Reunião ou agenda | +10 |
| Cliente ativo | +15 |
| Canal (WhatsApp, telefone, site…) | +4 a +12 |
| Esperando há mais de 8h / 24h | +6 / +12 |
| Automático, newsletter ou spam | -25 |
| Só agradecimento ("ok", "obrigado") | -12 |
| Mensagem muito curta | -8 |

A partir da nota vem a prioridade e o prazo de resposta: alta responde em até 2h,
média em 8h, baixa em 24h. Passou do prazo, a mensagem aparece como atrasada.

Para mudar os pesos ou incluir termos do seu negócio, edite a lista `RULES` nesse
arquivo. As mensagens já cadastradas podem ser repontuadas com
`POST /api/messages/:id/rescore`.

## O agente de triagem

Quem constrói o agente encontra o contrato completo em
[`docs/AGENTE.md`](docs/AGENTE.md): as três decisões possíveis, todos os campos,
o caminho de duas chamadas e o aviso de escalonamento. O resumo:

```bash
POST /api/messages          # registra a mensagem, com a decisão junto se já houver
POST /api/messages/:id/agent  # ou decide depois, em chamada separada
GET  /api/agent/queue       # mensagens que ainda esperam decisão
```

O arquivo `scripts/exemplo-agente.mjs` é um agente de mentira que exercita tudo
isso, útil para testar a integração antes de plugar o agente de verdade.

## Integrar com WhatsApp, e-mail ou formulário

Qualquer automação pode despejar mensagens no CRM por uma chamada HTTP. O campo
`external_id` evita duplicar a mesma mensagem se a automação reenviar.

```bash
curl -X POST http://localhost:3000/api/messages \
  -H 'content-type: application/json' \
  -H 'x-crm-token: SEU_TOKEN' \
  -d '{
    "sender_name": "Mariana Lopes",
    "sender_handle": "+5511988887777",
    "channel": "whatsapp",
    "body": "O painel está fora do ar e preciso resolver hoje",
    "external_id": "wpp-8891"
  }'
```

Se `sender_handle` bater com o e-mail ou telefone de um contato, a mensagem já
entra vinculada a ele.

## API

| Método e rota | O que faz |
| --- | --- |
| `GET /api/messages` | lista com filtros `status`, `needs_human`, `aguardando_agente`, `priority`, `channel`, `assigned_to`, `q`, `sort` |
| `POST /api/messages` | registra mensagem e calcula a relevância, aceita a decisão do agente junto |
| `POST /api/messages/:id/agent` | registra a decisão do agente |
| `POST /api/messages/:id/feedback` | avaliação do time sobre a decisão do agente |
| `GET /api/agent/queue` | mensagens sem decisão do agente |
| `GET /api/messages/:id` | detalhe de uma mensagem |
| `PATCH /api/messages/:id` | altera status, prioridade, responsável ou nota interna |
| `POST /api/messages/:id/rescore` | recalcula a pontuação |
| `GET /api/messages/:id/activities` | histórico da mensagem |
| `DELETE /api/messages/:id` | remove a mensagem |
| `GET /api/contacts` | lista com filtros `q` e `stage` |
| `POST /api/contacts` | cria contato |
| `GET/PATCH/DELETE /api/contacts/:id` | detalhe, edição e remoção |
| `GET /api/dashboard` | indicadores agregados |
| `GET/POST /api/onboarding` | esteira de onboarding, ver [`docs/ONBOARDING.md`](docs/ONBOARDING.md) |
| `POST /api/onboarding/whatsapp-group` | abre a franquia a partir de um grupo novo do WhatsApp |

## Estrutura

```
server/relevance.js   motor de pontuação das mensagens
server/onboarding.js  esteira de implantação das franquias
server/db.js          schema SQLite e log de atividades
server/api.js         regras de negócio
server/index.js       servidor HTTP e rotas
server/seed.js        dados de exemplo
public/tokens.css     tokens do design (cores, espaço, raios, fontes)
public/components.css componentes do design (classes sb-*)
public/styles.css     camada da aplicação, só com tokens
public/               interface web (HTML, CSS e JS puros)
scripts/              agente de exemplo para testar a integração
docs/AGENTE.md        contrato de integração com o agente
docs/ONBOARDING.md    etapas da esteira e entrada pelo WhatsApp
7bee-crm-design-handoff/  pacote de design original, com a referência visual
```

## Design

O visual segue o pacote em `7bee-crm-design-handoff/`: grafite quente com mel,
tema escuro por padrão e claro pelo botão da barra superior, que grava a escolha
no navegador. Toda cor, espaço e raio sai de `public/tokens.css`, então mudar um
token muda a interface inteira.

O mel marca o que precisa de atenção humana: botão principal, aba ativa, o
indicador "Precisam de você" e o agente quando ele escala. Verde é positivo,
vermelho é urgente ou negativo, azul é o que o agente fez sozinho e o neutro é
o que não tem carga. Cor nunca aparece sozinha: sempre acompanha uma palavra.

## Antes de expor na internet

O sistema nasceu para rodar na rede interna e não tem login. Se for publicar,
coloque atrás de um proxy com autenticação e defina `CRM_TOKEN` para proteger o
envio de mensagens.
