# Esteira de onboarding

Cada franquia é um card que anda pela esteira. As colunas do meio são as quatro
tarefas da implantação, então a coluna onde o card está já diz o que falta:

1. **Nova franquia** — entrada, onde a franquia aparece antes de alguém começar
2. **Cadastro na OpenAI**
3. **Criação de BM no Facebook**
4. **CTN**
5. **Teste do agente de vendas**
6. **Concluído**

Para mudar as etapas, edite a lista `STAGES` em `server/onboarding.js`. As
tarefas saem dessa mesma lista, então acrescentar uma etapa acrescenta a tarefa
correspondente nas franquias novas.

## Como o card anda

Arrastar o card e marcar as tarefas são duas formas de fazer a mesma coisa, e as
duas se mantêm em acordo:

- Arrastar para uma coluna marca como feitas as tarefas que ficaram para trás e
  devolve para pendente as que ficaram para frente.
- Marcar uma tarefa no detalhe move o card para a primeira tarefa que ainda
  falta. Quando todas terminam, a franquia vai para Concluído.

Uma tarefa pode ser travada quando depende de terceiros, como um documento que o
franqueado não mandou. O card mostra o aviso e a franquia aparece no indicador de
travadas, sem sumir da esteira.

Franquias paradas na mesma etapa por sete dias ou mais aparecem com aviso. Mude
esse limite pela variável `CRM_ONBOARDING_ALERTA_DIAS`.

## Meta de agilidade: 5 dias

A meta do bônus de agilidade do CS é concluir todas as tarefas do onboarding em
até 5 dias. O prazo conta da data de início da franquia até a conclusão da
última tarefa.

Cada card mostra onde a franquia está em relação à meta:

| Situação | Selo no card |
| --- | --- |
| Em andamento, com folga | Faltam 3 dias |
| Em andamento, falta menos de 1 dia | Falta menos de 1 dia (amarelo) |
| Em andamento, passou da meta | Atrasada 4 dias (vermelho) |
| Concluída dentro da meta | No prazo · 4 dias (verde, com brilho) |
| Concluída depois da meta | Fora do prazo · 31 dias (vermelho) |

O indicador **No prazo de 5 dias** mostra a porcentagem das franquias concluídas
dentro da meta, por exemplo "3 de 4 concluídas". Ele segue o filtro de período,
que olha a data de início: escolher "Este mês" mostra as franquias que começaram
neste mês.

O detalhe da franquia mostra a data de início, até quando vai a meta e em
quantos dias ela foi concluída.

**A data de início pode ser corrigida** em Editar dados, porque é dela que o prazo
conta. Serve para quando a franquia é cadastrada no CRM depois de o onboarding
já ter começado. Uma data escolhida à mão conta do começo daquele dia, e a
mudança fica registrada no histórico da franquia. Datas no futuro, ou depois da
conclusão, são recusadas.

Pausar uma franquia não para o relógio da meta.

Para mudar a meta:

| Variável | Para quê | Padrão |
| --- | --- | --- |
| `CRM_ONBOARDING_PRAZO_DIAS` | quantos dias a meta dá | `5` |
| `CRM_ONBOARDING_PRAZO_UTEIS` | `1` conta só dias úteis, pulando sábado e domingo | dias corridos |

## Entrada automática pelos grupos do WhatsApp

O CRM já tem a porta pronta para isso. Quando um grupo novo é criado no WhatsApp
do Guilherme, a automação chama:

```http
POST /api/onboarding/whatsapp-group
x-crm-token: SEU_TOKEN
content-type: application/json

{
  "group_id": "120363000000000001@g.us",
  "group_name": "7Bee x Mercado Bom Preço",
  "contact_name": "Patricia Nunes",
  "phone": "+5511970009999",
  "created_at": "2026-09-22 09:15:00"
}
```

A franquia entra na coluna Nova franquia com as quatro tarefas abertas, marcada
como vinda do WhatsApp. O `group_id` evita duplicar: se a automação reenviar o
mesmo grupo, o CRM devolve o registro que já existe em vez de criar outro.

O nome da franquia sai do nome do grupo, sem os prefixos que o time costuma usar:

| Nome do grupo | Vira |
| --- | --- |
| `Onboarding - Padaria Pão Quente` | Padaria Pão Quente |
| `7Bee x Auto Center Silva` | Auto Center Silva |
| `Franquia Norte - Implantação` | Franquia Norte |

Ajuste essas regras na função `nomeDaFranquia`, em `server/onboarding.js`.

### O que falta do lado do WhatsApp

Quem avisa o CRM é o provedor de WhatsApp, e é aí que está a decisão de vocês. A
API oficial da Meta, a Cloud API, não trata grupos: ela não entrega eventos de
grupo nem permite ler as conversas de grupo. Então, para detecção automática, o
caminho é um provedor que conecte no WhatsApp Web, como Evolution API, Z-API,
WPPConnect ou Venom. Todos eles emitem um evento quando o número entra em um
grupo novo, e é esse evento que a automação traduz para a chamada acima.

Vale saber do risco: esses provedores não são oficiais e o número pode ser
bloqueado pela Meta. Muita operação aceita esse risco em um número dedicado ao
CS, e é uma escolha de vocês, não uma limitação do CRM.

Enquanto isso não existe, o botão **Nova franquia** cadastra na mão em dez
segundos, e a esteira funciona igual.

## API

| Método e rota | O que faz |
| --- | --- |
| `GET /api/onboarding` | lista, com filtros `q`, `stage` e `situacao` |
| `POST /api/onboarding` | cadastra uma franquia na esteira |
| `GET /api/onboarding/:id` | detalhe com as tarefas |
| `PATCH /api/onboarding/:id` | edita dados ou muda a situação |
| `POST /api/onboarding/:id/stage` | move de etapa |
| `PATCH /api/onboarding/:id/tasks/:tarefa` | muda o status de uma tarefa |
| `GET /api/onboarding/:id/activities` | histórico da franquia |
| `DELETE /api/onboarding/:id` | remove a franquia |
| `POST /api/onboarding/whatsapp-group` | entrada automática por grupo novo |
| `GET /api/onboarding/stats` | indicadores da esteira |
| `GET /api/onboarding/meta` | etapas e tarefas configuradas |

Situação da franquia: `ativo`, `pausado` ou `cancelado`. Status de tarefa:
`pendente`, `feito` ou `bloqueado`.

## A franquia também vira contato

Toda franquia que entra na esteira ganha um contato no CRM na mesma hora, seja
pelo botão Nova franquia ou pela entrada automática do WhatsApp. É esse vínculo
que faz a mensagem dela chegar identificada na triagem.

O contato nasce com o nome da pessoa (ou da franquia, se ninguém foi informado),
a franquia como empresa, o telefone, a etapa `cliente`, a marcação de cliente
ativo e a tag `franquia`. Se já existe contato com o mesmo telefone ou com a
franquia como empresa, o CRM reaproveita em vez de duplicar. Editar os dados da
franquia atualiza o contato.

Mensagens antigas daquele telefone que ainda estavam sem dono passam a apontar
para o contato novo. Então uma franquia que escreveu antes de entrar na esteira
aparece ligada assim que o onboarding é criado.

## Abrir o grupo direto do card

Cada card da triagem e da esteira tem um atalho para o WhatsApp:

- **Abrir grupo**, quando a franquia tem link de convite do grupo salvo.
- **Abrir conversa**, quando só existe o telefone. O CRM monta o endereço
  `wa.me` com o número, assumindo Brasil quando o código do país não vem.

O link do grupo é colado no campo **Link de convite do grupo**, em Nova franquia
ou em Editar dados. Vale o convite inteiro (`https://chat.whatsapp.com/…`) ou só
o código. Qualquer outro endereço é recusado, porque esse valor vira um link
clicável na tela.

Quando a detecção automática de grupos estiver de pé, o provedor manda o convite
junto no campo `group_invite_link` e o atalho já nasce pronto.
