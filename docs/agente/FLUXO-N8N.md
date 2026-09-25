# Fluxo do agente no n8n — grupos CDT

Desenho do fluxo que atende as franquias nos grupos CDT pelo WhatsApp do
Guilherme. As regras de atendimento estão em [`../AGENTE.md`](../AGENTE.md) e o
conhecimento em [`base-de-conhecimento.md`](base-de-conhecimento.md). Aqui fica
**como** montar no n8n.

## Visão geral

```
Evolution (Guilherme-7Bee) ──webhook MESSAGES_UPSERT──▶ n8n
  1. Recebe e responde 200 na hora
  2. Só grupo? ── não ──▶ fim
  3. Mensagem do número do Guilherme? ── sim ──▶ CRM: mensagem-do-guilherme ▶ fim
  4. Mensagem de alguém da equipe (Victor, André)? ── sim ──▶ marca "equipe falou" ▶ fim
  5. CRM: contexto do grupo ── não é franquia CDT ──▶ fim
                           └─ agente pausado ─────▶ CRM: escala ▶ fim
  6. Áudio, imagem sem texto, figurinha? ── áudio/arquivo ──▶ CRM: escala ▶ fim
  7. Espera 90 s (junta mensagens seguidas e dá tempo da equipe responder)
  8. Alguém da equipe respondeu nesse meio-tempo? ── sim ──▶ CRM: ignorou ▶ fim
  9. IA classifica e escreve a resposta (saída em JSON)
 10. Decide:
       percebeu que é robô ──▶ CRM: pausa (alerta ao Guilherme) ▶ fim, sem responder
       não é pergunta ───────▶ CRM: ignorou ▶ fim
       tema bloqueado, confiança baixa ou precisa de humano ──▶ CRM: escala com rascunho ▶ fim
       pode responder ───────▶ 11
 11. Evolution: envia a resposta citando a mensagem
 12. CRM: registra o envio (id da mensagem) e a decisão "respondeu"
 Em qualquer erro ──▶ CRM: escala "falha do agente"
```

## Antes de montar

1. **Webhook da instância.** A instância `Guilherme-7Bee` está sem webhook hoje,
   então dá para apontar para o n8n sem derrubar nada. Configure só o evento
   `MESSAGES_UPSERT`, com `webhookByEvents` desligado e `webhookBase64`
   desligado (o fluxo não baixa mídia).
2. **CRM no ar e acessível pelo n8n,** com `CRM_TOKEN` definido. O n8n manda o
   token no cabeçalho `x-crm-token`.
3. **Credenciais no n8n:** a chave da Evolution (cabeçalho `apikey`), o token do
   CRM e a chave do modelo de IA que vocês já usam. Guarde tudo como credencial
   do n8n, nunca dentro do fluxo.
4. **Lista da equipe:** os números do Victor (2) e do André (2), numa variável
   do n8n (`EQUIPE_7BEE`). O número do Guilherme é o da própria instância.
5. **Aviso ao Guilherme:** defina `CRM_ESCALATION_WEBHOOK` no CRM apontando para
   um segundo fluxo do n8n (ver [Alertas](#alertas)).

## Os passos em detalhe

### 1. Webhook
Nó **Webhook** (POST). Responda na hora (`Respond: Immediately`), senão a
Evolution reenvia o evento. Os dados úteis ficam em `body.data`:

| Campo | Onde está |
| --- | --- |
| id da mensagem | `data.key.id` |
| grupo | `data.key.remoteJid` (termina em `@g.us`) |
| mandada pelo número do Guilherme | `data.key.fromMe` |
| número de quem mandou | `data.key.participantAlt` ou `data.key.participant` |
| nome de quem mandou | `data.pushName` |
| tipo | `data.messageType` (`conversation`, `extendedTextMessage`, `imageMessage`, `audioMessage`…) |
| texto | `data.message.conversation`, `data.message.extendedTextMessage.text` ou a legenda da mídia |
| mensagem citada | `data.contextInfo.stanzaId` |
| horário | `data.messageTimestamp` (segundos) |

### 2. Só grupos
**IF** `remoteJid` termina em `@g.us`. Conversas privadas ficam fora por
enquanto.

### 3. Mensagem do número do Guilherme
Se `fromMe` for verdadeiro, pode ser o Guilherme ou o próprio agente, porque o
agente responde por esse número. Chame o CRM:

```
POST /api/agent/mensagem-do-guilherme
{ "group_id": "<remoteJid>", "message_key": "<key.id>" }
```

- O CRM responde `do_agente: true` quando foi o agente: não faça nada.
- Quando foi o Guilherme, a pausa do grupo acaba sozinha (`retomado: true`).
- Grave também "equipe falou agora" para o grupo (passo 4).

Depois disso, o fluxo termina.

### 4. Mensagem de alguém da equipe
Se o número estiver em `EQUIPE_7BEE`, grave no **Workflow Static Data** o
horário da última fala da equipe naquele grupo:
`equipe[group_id] = messageTimestamp`. Depois disso, o fluxo termina.

### 5. Contexto do grupo no CRM

```
GET /api/agent/contexto?group_id=<remoteJid>
```

A resposta traz:

- `franquia`, que vem `null` quando o grupo não está na esteira. Nesse caso, fim.
- `pausado`. Se for `true`, registre a mensagem como escalada (passo 10, motivo
  "agente pausado neste grupo") e termine.
- `etapa_label` e `tarefas_pendentes`, que vão para a IA. Com isso ela responde
  "o que falta?" com precisão.

### 6. Tipo de mensagem
- Texto, ou imagem ou documento com legenda: segue.
- Áudio, ou imagem e documento sem texto: escala ("áudio, o agente não ouve") e
  termina.
- Figurinha, reação ou protocolo: termina sem registrar.

### 7. Espera
Nó **Wait** de 90 segundos. Isso serve para duas coisas:

- juntar mensagens seguidas da mesma pessoa;
- dar tempo para a equipe responder primeiro.

Depois da espera, busque as últimas mensagens do grupo:

```
POST {EVOLUTION}/chat/findMessages/Guilherme-7Bee
{ "where": { "key": { "remoteJid": "<grupo>" } }, "page": 1, "offset": 20 }
```

Junte num texto só as mensagens da mesma pessoa desde a primeira que disparou o
fluxo. Se chegar uma mensagem nova dessa pessoa durante a espera, deixe só a
execução mais recente seguir: compare o `key.id` da última mensagem dela com o
da mensagem que disparou esta execução.

### 8. A equipe respondeu?
Encerre, registrando no CRM como `ignorou` com o motivo "a equipe já respondeu",
em dois casos:

- `equipe[group_id]` é mais recente que a pergunta;
- nas mensagens buscadas, depois da pergunta, há uma do Guilherme que não foi
  enviada pelo agente, ou uma do Victor ou do André.

Mensagens do Guilherme enviadas pelo agente são as que o CRM responde com
`do_agente: true`.

### 9. IA: classificar e responder
Nó do modelo de IA com **saída estruturada** (JSON), em três partes:

- **System prompt:**
  - as regras de [`AGENTE.md`](../AGENTE.md);
  - os itens ✅ e ⚠️ da base de conhecimento, depois da revisão do Guilherme;
  - o contexto da franquia (etapa e pendências).
- **Entrada:** o texto juntado, quem mandou e as últimas 10 mensagens do grupo,
  para dar contexto.
- **Saída esperada:**

```json
{
  "e_pergunta": true,
  "percebeu_robo": false,
  "tema_bloqueado": null,
  "tema": "Cadastro do cartão na Meta",
  "confianca": 0.86,
  "precisa_humano": false,
  "resposta": "texto para mandar no grupo, como o Guilherme escreveria",
  "motivo": "por que decidiu assim, em uma frase"
}
```

- `tema_bloqueado` é `null` ou um destes valores: `valores_7bee`, `contrato`,
  `cancelamento`, `reclamacao`, `problema_tecnico`.
- `percebeu_robo` é `true` quando a pessoa pergunta se é robô, IA, bot ou
  resposta automática. Vale também quando comenta que "parece robô", que a
  resposta "veio rápido demais" ou algo parecido. **Na dúvida, `true`.**
- O agente escreve como o Guilherme: tom curto e direto, igual ao das
  respostas da base. Não assina.

### 10. Decisão

| Situação | O que o fluxo faz |
| --- | --- |
| `percebeu_robo` | `POST /api/agent/pausa` com `group_id`, `group_name`, `texto`, `remetente`, `message_external_id`. **Não responde no grupo.** O CRM cria o alerta de prioridade alta, pausa o grupo e avisa o webhook. |
| não é pergunta | `POST /api/messages` com `agent.decision = "ignorou"` |
| `tema_bloqueado`, `precisa_humano` ou `confianca` < 0,75 | `POST /api/messages` com `agent.decision = "escalou"`, `reason` e `suggested_reply` (o rascunho, para o Guilherme aproveitar). Não responde no grupo. |
| pode responder | passo 11 |

Registro de mensagem no CRM (vale para todas as linhas):

```json
{
  "body": "<texto da franquia>",
  "channel": "whatsapp",
  "sender_name": "<pushName>",
  "sender_handle": "<número>",
  "thread_id": "<group_id>",
  "external_id": "<key.id>",
  "received_at": "<AAAA-MM-DD HH:MM:SS em UTC>",
  "agent": { "decision": "…", "agent": "agente-cdt", "intent": "<tema>", "confidence": 0.86,
             "reason": "<motivo>", "reply": "<só quando respondeu>", "suggested_reply": "<rascunho>" }
}
```

### 11. Responder no grupo

```
POST {EVOLUTION}/message/sendText/Guilherme-7Bee
{ "number": "<group_id>", "text": "<resposta>",
  "quoted": { "key": { "id": "<key.id da pergunta>" }, "message": { "conversation": "<texto da pergunta>" } } }
```

Use um atraso de digitação curto (`delay`), para não parecer instantâneo.

### 12. Registrar
1. `POST /api/agent/envio` com `{ "message_key": "<key.id devolvido pelo sendText>", "group_id": "…" }`.
   **Sem esse passo, a próxima mensagem do agente seria tomada como sendo do
   Guilherme e retomaria o grupo pausado.**
2. `POST /api/messages` com `agent.decision = "respondeu"` e `reply` = o texto
   enviado.

### Erros
Ligue o **Error Workflow** do n8n num fluxo que registra no CRM uma mensagem
escalada com o motivo "falha do agente" e o erro. Assim nenhuma pergunta some.

## Alertas

O CRM chama `CRM_ESCALATION_WEBHOOK` em duas situações:

| `tipo` | Quando |
| --- | --- |
| `escalonamento` | qualquer mensagem escalada |
| `agente_pausado` | a franquia percebeu que é robô: o agente parou naquele grupo |

Monte um segundo fluxo pequeno no n8n que recebe esse webhook e manda o aviso ao
Guilherme. Sugestão:

- enviar pela instância `Victor - 7Bee` para o número pessoal do Guilherme;
- `agente_pausado` sempre notifica;
- `escalonamento` pode ir num resumo a cada hora, para não virar ruído.

Mandar pela própria instância do Guilherme não serve: seria ele mandando
mensagem para si mesmo, sem notificação.

No CRM, o grupo pausado aparece em vermelho no topo da Triagem, com os botões
**Abrir grupo** e **Reativar agente**. O card da franquia ganha o selo
**Agente pausado**. A pausa acaba sozinha quando o Guilherme escreve no grupo.

## Como ligar sem risco

1. **Modo sugestão.** Uma variável `MODO = sugestao` faz o passo 10 sempre
   escalar com o rascunho e nunca enviar nada. O Guilherme avalia cada rascunho
   no CRM (acertou, resposta ruim…). Rode assim por 2 a 3 semanas.
2. **Envio automático.** Com o índice de acerto bom no Painel, troque para
   `MODO = automatico`. Se preferir, comece só pelos temas que mais acertaram.
3. **Ajuste contínuo.** Cada "resposta ruim" marcada no CRM vira correção na
   base de conhecimento.

## Pendências para montar

- A revisão da base pelo Guilherme (planilha `revisao-base-de-conhecimento.xlsx`).
- O CRM hospedado num endereço que o n8n alcance.
- Qual modelo de IA usar no nó do passo 9: o mesmo que vocês já usam nos outros
  fluxos.
- O número pessoal do Guilherme para os alertas, cadastrado como variável no
  n8n.
