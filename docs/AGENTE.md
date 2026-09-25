# Integração com o agente de atendimento

O agente é quem faz a primeira triagem. Ele lê cada mensagem que chega, responde
sozinho o que consegue resolver e escala para o Guilherme só o que precisa de
gente. O CRM é o painel de controle disso: guarda a decisão, o motivo, a resposta
enviada e a avaliação do time sobre o acerto do agente.

## O fluxo

1. A mensagem chega de um canal (WhatsApp, e-mail, site).
2. O agente registra a mensagem no CRM e decide o que fazer com ela.
3. Se resolveu sozinho, a mensagem fica como **respondida pelo agente**, visível
   para auditoria mas fora da fila do CS.
4. Se escalou, a mensagem entra na aba **Precisam de você**, já com o motivo e,
   se o agente quiser, um rascunho de resposta.
5. O Guilherme responde e avalia se o agente acertou. Essa avaliação vira o
   material para ajustar o agente.

## Regras de atendimento (definidas pela 7Bee)

Estas regras valem para o agente que vai atender os grupos das franquias CDT
pelo WhatsApp do Guilherme. O fluxo do agente ainda vai ser montado no n8n.

**Quando responder**

- Só quando houver uma pergunta. Recado, agradecimento, "ok" e figurinha não
  recebem resposta.
- Se alguém da 7Bee (Guilherme, Victor ou André) já respondeu à pergunta, o
  agente fica em silêncio. Isso vale também se a pessoa responder enquanto o
  agente ainda está decidindo.
- Funciona 24 horas por dia, inclusive fora do horário comercial.

**O que nunca responde, sempre escala para o Guilherme**

| Tema | Exemplos |
| --- | --- |
| Cobrança e valores | boleto, mensalidade, reajuste, desconto, nota fiscal |
| Contrato | cláusulas, renovação, multa, troca de plano |
| Cancelamento | pedido ou ameaça de cancelar, pausa do serviço |
| Reclamação | insatisfação, cobrança de prazo, tom de irritação |
| Problema técnico | agente fora do ar, erro, integração parada, acesso que não funciona |

Nesses casos, o agente registra a mensagem no CRM com `decision: "escalou"` e o
motivo, e não manda nada no grupo.

**Como se apresenta**

- Assina como Guilherme, no número do Guilherme.
- Ponto em aberto: o que responder se a franquia perguntar diretamente se está
  falando com um robô.

**O que ele sabe**

- A base de conhecimento vem das respostas que o Guilherme e o Victor, que fazia
  a função antes, já deram nos grupos CDT.
- O Guilherme revisa a base antes de o agente entrar no ar.

## As três decisões possíveis

| Decisão | O que significa | Onde a mensagem vai parar |
| --- | --- | --- |
| `respondeu` | o agente já respondeu ao cliente | Respondidas pelo agente |
| `escalou` | precisa de resposta humana | Precisam de você |
| `ignorou` | spam, automático ou irrelevante | Descartadas |

Há um caso extra importante: o agente pode responder **e** pedir conferência
humana, mandando `decision: "respondeu"` junto com `needs_human: true`. A
mensagem entra na fila do CS mostrando o que já foi respondido. Use isso quando
a confiança for baixa.

## Chamada principal

Registrar a mensagem e a decisão de uma vez só, que é o caminho mais simples:

```http
POST /api/messages
x-crm-token: SEU_TOKEN
content-type: application/json
```

```json
{
  "sender_name": "Mariana Lopes",
  "sender_handle": "+5511988887777",
  "channel": "whatsapp",
  "body": "O painel está fora do ar e preciso fechar o relatório hoje",
  "external_id": "wpp-8891",
  "thread_id": "5511988887777",
  "agent": {
    "agent": "agente-cs",
    "decision": "escalou",
    "confidence": 0.93,
    "intent": "incidente",
    "reason": "Cliente ativo relatando indisponibilidade com prazo hoje.",
    "suggested_reply": "Oi Mariana, o time já está olhando. Te dou posição em 30 minutos."
  }
}
```

Campos da mensagem:

| Campo | Obrigatório | Para quê |
| --- | --- | --- |
| `body` | sim | o texto que o cliente mandou |
| `sender_name` | não | nome de quem enviou |
| `sender_handle` | não | e-mail ou telefone, usado para achar o contato já cadastrado |
| `channel` | não | `whatsapp`, `email`, `instagram`, `site`, `telefone`, `chat`, `outro` |
| `subject` | não | assunto, quando for e-mail |
| `received_at` | não | quando chegou, no formato `AAAA-MM-DD HH:MM:SS` em UTC |
| `external_id` | não | id da mensagem no canal de origem, evita duplicar |
| `thread_id` | não | id da conversa, para agrupar mensagens do mesmo atendimento |

Campos do bloco `agent`:

| Campo | Obrigatório | Para quê |
| --- | --- | --- |
| `decision` | sim | `respondeu`, `escalou` ou `ignorou` |
| `reply` | quando respondeu | o texto que o agente mandou ao cliente |
| `agent` | não | nome ou versão do agente, aparece no card |
| `confidence` | não | número de 0 a 1 |
| `intent` | não | categoria que o agente identificou, como `churn` ou `preco` |
| `reason` | não | por que escalou ou descartou, é o que o CS lê primeiro |
| `suggested_reply` | não | rascunho para o humano aproveitar |
| `priority` | não | força `alta`, `media` ou `baixa` |
| `needs_human` | não | `true` obriga a passar pelo humano mesmo tendo respondido |

## Decidir depois, em uma segunda chamada

Se o agente registra a mensagem assim que ela chega e só decide depois, use as
duas chamadas separadas. Primeiro o `POST /api/messages` sem o bloco `agent`,
guardando o `id` que volta, e depois:

```http
POST /api/messages/:id/agent
x-crm-token: SEU_TOKEN
```

com o mesmo conteúdo do bloco `agent` acima.

Nesse modelo o agente também pode buscar o que está pendente:

```http
GET /api/agent/queue
x-crm-token: SEU_TOKEN
```

Volta as mensagens que ainda não têm decisão. Se uma mensagem ficar parada mais
tempo que o limite (`CRM_AGENT_TIMEOUT_MIN`, padrão 10 minutos), o card avisa na
tela que o agente pode estar fora do ar, para ninguém ficar esperando resposta
que não vem.

## Avaliação do time

O Guilherme avalia cada decisão pelos botões do card. Isso também está na API:

```http
POST /api/messages/:id/feedback
{ "feedback": "deveria_escalar", "note": "era um cliente antigo reclamando" }
```

Valores aceitos: `acertou`, `deveria_escalar`, `nao_precisava_escalar` e
`resposta_ruim`. O painel mostra o acumulado, que é o que indica onde o agente
precisa melhorar.

## Aviso de escalonamento

Quando uma mensagem é escalada, o CRM pode avisar um endereço externo, útil para
tocar no Slack ou no WhatsApp do CS. Basta definir a variável
`CRM_ESCALATION_WEBHOOK` com a URL que recebe o aviso. O corpo enviado é:

```json
{
  "tipo": "escalonamento",
  "mensagem_id": 12,
  "de": "Mariana Lopes",
  "canal": "whatsapp",
  "prioridade": "alta",
  "motivo_do_agente": "Cliente ativo relatando indisponibilidade",
  "texto": "O painel está fora do ar...",
  "rascunho_sugerido": "Oi Mariana, o time já está olhando."
}
```

## Segurança

Defina `CRM_TOKEN` no ambiente do CRM e mande o mesmo valor no cabeçalho
`x-crm-token` (ou `Authorization: Bearer ...`) nas chamadas do agente. Sem a
variável definida, o CRM aceita qualquer chamada, o que só serve para testes na
máquina local.

## Testar a integração

O arquivo `scripts/exemplo-agente.mjs` simula um agente completo: registra
mensagens, decide cada uma e mostra o resultado. Rode com o CRM no ar:

```bash
CRM_TOKEN=segredo node scripts/exemplo-agente.mjs
```
