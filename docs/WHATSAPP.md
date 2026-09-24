# Conectar o WhatsApp do CS

O CRM lê o WhatsApp do Guilherme de um de dois jeitos:

- **Evolution API (recomendado).** O número já está conectado na Evolution, na
  instância `Guilherme-7Bee`, a mesma que o agente usa. O CRM lê de lá, sem QR
  code e sem um segundo aparelho conectado no celular.
- **QR code.** O próprio CRM vira um aparelho conectado, como o WhatsApp Web.
  Serve para quando não houver Evolution.

Com a Evolution configurada, o CRM usa a Evolution. Sem ela, usa o QR code. Nos
dois casos, a tela é a mesma (aba **Onboarding**, botão **Importar do
WhatsApp**), e o CRM:

- lista todos os grupos em que o número está, para importar as franquias que já
  existem na esteira de onboarding;
- coloca na coluna Nova franquia cada grupo novo em que o Guilherme entrar.

O CRM lê só os dados dos grupos: nome, data de criação e quantidade de
participantes. Nenhuma mensagem é lida nem guardada.

## Pela Evolution API

### Configurar

Defina três variáveis no computador ou servidor onde o CRM roda e inicie o CRM:

```bash
EVOLUTION_URL="https://evolution.7bee.top" \
EVOLUTION_INSTANCE="Guilherme-7Bee" \
EVOLUTION_API_KEY="…" \
CRM_WHATSAPP_FILTRO="CDT" \
npm start
```

- `EVOLUTION_API_KEY` é a chave global da Evolution, a mesma que o n8n usa. Ela
  fica só no servidor: o navegador nunca recebe a chave. Não coloque a chave em
  arquivo que vá para o Git.
- `CRM_WHATSAPP_FILTRO="CDT"` faz só os grupos com "CDT" no nome entrarem
  sozinhos na esteira. Assim, grupos pessoais ou internos ficam de fora. Os
  grupos das unidades seguem os formatos `CDT - Guriri ES`, `CDT.IA - Varginha`
  e `IA CDT - Campo Limpo`, e os três passam por esse filtro.

Ao subir, o CRM já confere a instância e lê os grupos. No log aparece
`Evolution: instância Guilherme-7Bee lida, N grupos.`

### Importar as franquias que já existem

1. Na aba **Onboarding**, clique em **WhatsApp conectado**.
2. Digite `CDT` na busca e clique em **Marcar os N da lista**.
3. Ajuste a etapa de cada unidade que já passou da Nova franquia. Desmarque o
   que não for franquia (por exemplo, `CDT.IA - Gestão`).
4. Clique em **Importar para a esteira**.

O nome da franquia sai sem o prefixo: `CDT - Guriri ES` vira `Guriri ES`. O
nome completo do grupo continua guardado no card. O CRM tenta pegar o link de
convite de cada grupo. Quando o Guilherme é admin, o botão do card abre o grupo
direto. Quando não é, a franquia entra sem link, e o link pode ser colado depois
em **Editar dados**.

### Grupos novos

A primeira leitura nunca importa nada sozinha: a escolha é do Guilherme. Depois
dela, o CRM confere a Evolution a cada 5 minutos (`CRM_EVOLUTION_INTERVALO_MIN`).
Todo grupo que aparecer e passar pelo filtro vira franquia na coluna Nova
franquia. Se o CRM ficar desligado, os grupos criados nesse meio-tempo entram
quando ele voltar.

Para os grupos novos entrarem na hora, sem esperar os 5 minutos, a Evolution
pode avisar o CRM por webhook. Isso só funciona se a Evolution conseguir acessar
o endereço do CRM:

- URL: `https://<endereço-do-crm>/api/whatsapp/evolution-webhook?token=<CRM_TOKEN>`
- Evento: `GROUPS_UPSERT`

**Cuidado:** a instância `Guilherme-7Bee` provavelmente já manda webhook para o
n8n do agente. A Evolution guarda um webhook só por instância, então trocar a
URL lá desliga o agente. O CRM nunca mexe no webhook da instância. Se quiser o
aviso na hora, a saída é o n8n repassar os eventos `groups.upsert` para a URL
acima. Sem isso, a conferência a cada 5 minutos já resolve.

### O que o CRM faz e não faz na Evolution

O CRM só faz leituras: a instância (para saber se está conectada, o número e o
nome do perfil), a lista de grupos sem participantes, e o link de convite na
importação. Ele nunca desconecta a instância, nunca manda mensagem e nunca muda
o webhook. Por isso a janela tem **Ler de novo** em vez de **Desconectar**.

Se a janela mostrar erro:

| Mensagem | O que fazer |
| --- | --- |
| A Evolution recusou a chave | confira `EVOLUTION_API_KEY` |
| não encontrou a instância | confira `EVOLUTION_INSTANCE`, com maiúsculas e hífen |
| está desconectado na Evolution | reconecte o número pelo painel da Evolution; o agente também está parado |
| não consegui falar com a Evolution | confira `EVOLUTION_URL` e se o servidor do CRM acessa a internet |

## Pelo QR code

Use este caminho só quando a Evolution não estiver configurada.

### Antes de começar: onde o CRM roda

O QR code aparece dentro do próprio CRM, então o CRM precisa estar rodando num
computador da operação. Pode ser a máquina do Guilherme ou um servidor que fique
ligado. A conexão só funciona enquanto o CRM estiver aberto nessa máquina; se o
computador desligar, a entrada automática de grupos novos para até ele voltar.

Na pasta do CRM, uma vez só:

```bash
npm install
npm start
```

O `npm install` instala a biblioteca de conexão com o WhatsApp. Sem ela o resto
do CRM funciona normalmente, só a tela de conexão avisa o que falta.

### Passo a passo da conexão

1. Abra o CRM no navegador (`http://localhost:3000`) e vá na aba **Onboarding**.
2. Clique em **Importar do WhatsApp** e depois em **Gerar QR code**.
3. No celular do Guilherme, abra o WhatsApp:
   - no Android, toque nos três pontos no canto de cima;
   - no iPhone, vá em Configurações.
4. Toque em **Aparelhos conectados** e depois em **Conectar um aparelho**.
5. Aponte a câmera para o QR code da tela. Ele se renova sozinho a cada poucos
   segundos, então deixe a janela aberta até conectar.

Em poucos segundos a janela mostra o número conectado e a lista de grupos. No
celular, o CRM aparece na lista de aparelhos conectados como "CRM 7Bee".

### Importar as franquias que já existem

A lista mostra só os grupos que ainda não estão na esteira. Para cada franquia:

1. Marque o grupo.
2. Escolha a etapa em que ela está hoje. Escolher a etapa já marca o grupo.
3. Clique em **Importar para a esteira**.

O nome da franquia sai do nome do grupo, sem prefixos como "CDT -", "7Bee x"
ou "Onboarding -". Cada franquia importada também vira contato. Quando o número
conectado é admin do grupo, o link de convite vem junto e o botão do card abre
o grupo direto. Grupos de família ou de outros assuntos é só não marcar.

Importar de novo o mesmo grupo não duplica: ele aparece como "já está na
esteira".

### Grupos novos

Enquanto a conexão estiver ativa, todo grupo novo em que o Guilherme entrar
vira franquia na coluna Nova franquia. Para evitar que grupos pessoais entrem,
defina um filtro pelo nome do grupo antes de iniciar o CRM:

```bash
CRM_WHATSAPP_FILTRO="CDT" npm start
```

Para desligar a entrada automática e usar só a importação manual:

```bash
CRM_WHATSAPP_AUTO=0 npm start
```

### Desconectar

Na mesma janela, **Desconectar** tira o CRM da lista de aparelhos do celular e
apaga a sessão salva. Remover o aparelho direto pelo celular tem o mesmo efeito.

### Riscos e cuidados

- **Não é a API oficial.** A API oficial do WhatsApp não permite ler grupos. A
  conexão usa a biblioteca Baileys, que funciona como o WhatsApp Web, mas não é
  oficial. Existe risco de o WhatsApp restringir o número. Muitas operações
  aceitam esse risco num número dedicado ao atendimento.
- **A sessão dá acesso ao WhatsApp.** Ela fica em `data/whatsapp-sessao`, que
  não vai para o Git. Quem copiar essa pasta consegue usar a conexão. Não
  compartilhe a pasta `data/`.
- **O CRM não tem login.** Quem abre o CRM consegue gerar o QR, ver os nomes dos
  grupos e desconectar. Mantenha o CRM na rede interna, como já recomendado no
  README.

### Testar sem celular

O modo simulado mostra a tela inteira com grupos de exemplo, sem conectar em
nada:

```bash
npm run start:simulado
```

Na janela do QR aparece o botão **Simular leitura do celular**, que faz o papel
do celular.

## Variáveis

| Variável | Para quê | Padrão |
| --- | --- | --- |
| `EVOLUTION_URL` | endereço da Evolution API; liga o modo Evolution | vazio (usa QR code) |
| `EVOLUTION_INSTANCE` | instância do WhatsApp do CS na Evolution | vazio |
| `EVOLUTION_API_KEY` | chave da Evolution, só no servidor | vazio |
| `CRM_EVOLUTION_INTERVALO_MIN` | minutos entre conferências de grupos novos (`0` desliga) | `5` |
| `CRM_WHATSAPP_FILTRO` | só grupos com nome que combina entram sozinhos (expressão regular, sem diferenciar maiúsculas) | vazio (todos) |
| `CRM_WHATSAPP_AUTO` | `0` desliga a entrada automática de grupos novos | ligada |
| `CRM_WHATSAPP_SESSAO` | pasta da sessão | `data/whatsapp-sessao` |
| `CRM_WHATSAPP_SIMULADO` | `1` liga o modo de teste sem celular | desligado |

## API

| Método e rota | O que faz |
| --- | --- |
| `GET /api/whatsapp/status` | fase da conexão, `provedor` (`evolution` ou QR) e o QR code quando está esperando o celular |
| `POST /api/whatsapp/conectar` | QR: começa a conexão e gera o QR. Evolution: relê a instância e os grupos |
| `POST /api/whatsapp/desconectar` | QR: encerra e apaga a sessão. Evolution: só para a leitura no CRM |
| `POST /api/whatsapp/evolution-webhook` | recebe `GROUPS_UPSERT` da Evolution; token em `?token=` ou no cabeçalho |
| `GET /api/whatsapp/grupos` | grupos do número conectado |
| `POST /api/whatsapp/importar` | leva os grupos escolhidos para a esteira: `{ "grupos": [{ "id": "…@g.us", "stage": "ctn" }] }` |
