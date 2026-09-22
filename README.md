# CRM 7Bee

CRM interno enxuto para a operação: o time registra as mensagens que chegam de
vários canais, o sistema pontua automaticamente quais são realmente relevantes e
o CS (Guilherme) responde na ordem certa, sem perder o que importa.

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
| `CRM_TOKEN` | exige token no envio de mensagens via API | vazio (sem token) |

## As três abas

**Triagem de mensagens** é o coração do CRM. Cada mensagem recebe uma nota de 0 a
100 e uma prioridade, com a explicação de *por que* ela subiu ou desceu na fila.
O CS trabalha de cima para baixo e marca cada item como relevante, respondida ou
ignorada. Os indicadores do topo mostram o que está em aberto, o que passou do
prazo e o tempo médio de resposta.

**Contatos** guarda quem é quem: empresa, canais, etapa no funil, responsável e
observações. Marcar alguém como cliente ativo faz as mensagens dessa pessoa
subirem na triagem automaticamente.

**Painel** reúne os números do período: volume por canal e distribuição do funil.

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
| `GET /api/messages` | lista com filtros `status`, `priority`, `channel`, `assigned_to`, `q`, `sort` |
| `POST /api/messages` | registra mensagem e calcula a relevância |
| `GET /api/messages/:id` | detalhe de uma mensagem |
| `PATCH /api/messages/:id` | altera status, prioridade, responsável ou nota interna |
| `POST /api/messages/:id/rescore` | recalcula a pontuação |
| `GET /api/messages/:id/activities` | histórico da mensagem |
| `DELETE /api/messages/:id` | remove a mensagem |
| `GET /api/contacts` | lista com filtros `q` e `stage` |
| `POST /api/contacts` | cria contato |
| `GET/PATCH/DELETE /api/contacts/:id` | detalhe, edição e remoção |
| `GET /api/dashboard` | indicadores agregados |

## Estrutura

```
server/relevance.js   motor de pontuação das mensagens
server/db.js          schema SQLite e log de atividades
server/api.js         regras de negócio
server/index.js       servidor HTTP e rotas
server/seed.js        dados de exemplo
public/               interface web (HTML, CSS e JS puros)
```

## Antes de expor na internet

O sistema nasceu para rodar na rede interna e não tem login. Se for publicar,
coloque atrás de um proxy com autenticação e defina `CRM_TOKEN` para proteger o
envio de mensagens.
