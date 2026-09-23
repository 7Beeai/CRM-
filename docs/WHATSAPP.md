# Conectar o WhatsApp do CS

O CRM se conecta ao WhatsApp do Guilherme pela leitura de um QR code, do mesmo
jeito que o WhatsApp Web. Com a conexão feita, ele:

- lista todos os grupos em que o número está, para importar as franquias que já
  existem na esteira de onboarding;
- coloca na coluna Nova franquia cada grupo novo em que o Guilherme entrar,
  enquanto a conexão estiver ativa.

O CRM lê só os dados dos grupos: nome, data de criação e quantidade de
participantes. Nenhuma mensagem é lida nem guardada, e o histórico que o
WhatsApp oferece na conexão é recusado.

## Antes de começar: onde o CRM roda

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

## Passo a passo da conexão

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

## Importar as franquias que já existem

A lista mostra só os grupos que ainda não estão na esteira. Para cada franquia:

1. Marque o grupo.
2. Escolha a etapa em que ela está hoje. Escolher a etapa já marca o grupo.
3. Clique em **Importar para a esteira**.

O nome da franquia sai do nome do grupo, sem prefixos como "7Bee x" ou
"Onboarding -". Cada franquia importada também vira contato. Quando o número
conectado é admin do grupo, o link de convite vem junto e o botão do card abre
o grupo direto. Grupos de família ou de outros assuntos é só não marcar.

Importar de novo o mesmo grupo não duplica: ele aparece como "já está na
esteira".

## Grupos novos

Enquanto a conexão estiver ativa, todo grupo novo em que o Guilherme entrar
vira franquia na coluna Nova franquia. Para evitar que grupos pessoais entrem,
defina um filtro pelo nome do grupo antes de iniciar o CRM:

```bash
CRM_WHATSAPP_FILTRO="7bee|onboarding" npm start
```

Para desligar a entrada automática e usar só a importação manual:

```bash
CRM_WHATSAPP_AUTO=0 npm start
```

## Desconectar

Na mesma janela, **Desconectar** tira o CRM da lista de aparelhos do celular e
apaga a sessão salva. Remover o aparelho direto pelo celular tem o mesmo efeito.

## Riscos e cuidados

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

## Testar sem celular

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
| `CRM_WHATSAPP_FILTRO` | só grupos com nome que combina entram sozinhos | vazio (todos) |
| `CRM_WHATSAPP_AUTO` | `0` desliga a entrada automática de grupos novos | ligada |
| `CRM_WHATSAPP_SESSAO` | pasta da sessão | `data/whatsapp-sessao` |
| `CRM_WHATSAPP_SIMULADO` | `1` liga o modo de teste sem celular | desligado |

## API

| Método e rota | O que faz |
| --- | --- |
| `GET /api/whatsapp/status` | fase da conexão e o QR code quando está esperando o celular |
| `POST /api/whatsapp/conectar` | começa a conexão e gera o QR |
| `POST /api/whatsapp/desconectar` | encerra e apaga a sessão |
| `GET /api/whatsapp/grupos` | grupos do número conectado |
| `POST /api/whatsapp/importar` | leva os grupos escolhidos para a esteira: `{ "grupos": [{ "id": "…@g.us", "stage": "ctn" }] }` |
