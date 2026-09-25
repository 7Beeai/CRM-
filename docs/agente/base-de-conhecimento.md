# Base de conhecimento do agente — grupos CDT

> **Rascunho para revisão do Guilherme.** Montado a partir de 3.603 mensagens dos
> 33 grupos CDT, de 20/07 a 25/09/2026, com as respostas que o Guilherme, o Victor
> e o restante da equipe 7Bee deram às franquias. Nenhum nome, telefone, e-mail,
> login ou senha foi copiado. O que é específico de cada unidade aparece entre
> chaves, por exemplo `{link do dashboard}`.
>
> Como revisar: corrija as respostas, apague o que não vale mais e preencha as
> lacunas da seção [O que falta responder](#o-que-falta-responder). Depois de
> revisado, este arquivo vira o conhecimento do agente no n8n.

## Legenda

| Marca | O que o agente faz |
| --- | --- |
| ✅ | Responde sozinho. |
| ⚠️ | Responde a parte geral e escala o que depende da unidade. Por exemplo: pede a matrícula e passa para o Guilherme. |
| ⛔ | Não responde. Registra no CRM como escalada e fica em silêncio no grupo. |
| ❓ | A confirmar se é "relacionado a cobrança". Até a confirmação, o agente escala. |

**Regra que vale acima de tudo:** o agente não responde **nada relacionado a**
cobrança e valores, contrato, cancelamento, reclamação ou problema técnico.

- "Cobrança" inclui a cobrança feita pela IA: réguas, disparos aos
  inadimplentes, pagamentos, baixas, reembolsos, descontos e campanhas. Inclui
  também a cobrança da 7Bee à franquia.
- "Valores" inclui qualquer valor ou custo, de quem for: 7Bee, OpenAI, Meta,
  números e campanhas.
- Na dúvida, o agente escala.

Ao montar o agente no n8n, **carregue só os itens ✅ e ⚠️**. O texto dos itens
⛔ e ❓ fica aqui só como referência para a equipe, e o agente não pode ter
acesso a ele.

A frequência entre parênteses é aproximada: quantas vezes o tema apareceu no
histórico.

---

## O que é o serviço (contexto para o agente)

A 7Bee opera, para cada unidade do Cartão de TODOS, uma IA que conversa com os
filiados pelo WhatsApp:

- **Cobrança:** contata os inadimplentes da lista do dia e envia o link de
  pagamento (link de conciliação da franqueadora, com cartão ou PIX).
- **Relacionamento:** fala com os filiados em dia sobre benefícios e comunicações
  da unidade.
- **Agente de Vendas:** atende os leads que chegam pelos anúncios da unidade e
  vende pelo link de filiação da própria IA.

A unidade acompanha tudo em duas ferramentas:

- **Dashboard:** pagamentos, clientes em cobrança e desempenho do dia.
- **Chat CDT:** conversas em tempo real. A equipe da unidade assume ali quando a
  IA passa o atendimento para um humano.

A implantação tem três fases:

1. Documentação.
2. Parametrização: conta na OpenAI, Business Manager da Meta, números, cartão
   na Meta e acesso ao CTN.
3. Início, com 60 dias de período de teste.

---

## 1. Rotina diária das planilhas (Power BI) — o tema mais frequente (~47) ❓

> **A confirmar.** A planilha de inadimplência alimenta a cobrança, então pode
> contar como "relacionado a cobrança". Se for liberada, o agente responde tudo
> desta seção menos o último item. Até lá, escala.

### Quais planilhas subir, onde e em que horário ❓
São 2 relatórios do Power BI em XLSX, cada um na sua pasta do Drive:

1. **Inadimplência** (para a cobrança): todos os dias, até **8:30**, na
   `{pasta de inadimplência}`.
2. **Filiados ativos** (para o relacionamento): 1 vez por semana, de preferência
   na **segunda-feira**, também até 8:30, na `{pasta de filiados ativos}`.

Como subir:

- Sem tratamento, sem filtro e sem ajuste. É só extrair no formato padrão do BI:
  as réguas e os filtros a gente faz do nosso lado.
- Não mande a planilha no grupo: ela precisa ir para o Drive.
- Não crie subpastas.
- Atenção para não inverter as pastas. Se inverter, o sistema pode tratar
  cliente em dia como devedor.

### Por que até 8:30 ❓
O primeiro disparo do dia sai por volta das **8:50** e é o de melhor resultado. O
disparo seguinte sai às 11:30. Começar por volta das 9h rende bem mais do que
começar depois das 10h.

### O BI não atualizou. Subo a lista antiga ou espero? ❓
- Não suba a lista antiga: essa a gente já tem.
- Espere o BI atualizar e suba assim que possível. Avise aqui no grupo quando o
  BI atrasar.
- O sistema espera uma lista nova **até as 10h**. Depois disso, trabalha com a
  lista do dia anterior, tirando quem já pagou pela IA.

### Dá para ter um prazo maior que 8:30? ❓
A gente trabalha com esse padrão em todas as unidades. A tolerância até as 10h
existe justamente para os atrasos do BI, mas cada minuto depois das 8:30 pesa
no resultado do dia.

### Dias sem expediente, domingos e feriados ❓
- Nos dias de disparo sem lista nova, a IA usa a do dia anterior, tirando quem
  já pagou.
- **Aos domingos não há disparos.**
- Aos sábados, subir a lista não é obrigatório, mas com a lista atualizada o
  resultado é melhor.
- Nos feriados, a estratégia é reduzida.
- Avise os feriados municipais com antecedência.

### Podemos tirar clientes ou colunas para dividir a cobrança com a equipe? ⛔
Mantenha a lista completa, no formato do BI. Remover colunas ou clientes quebra
a sincronização. Para dividir o trabalho:

- suba a lista completa;
- a equipe trabalha da régua 2 em diante;
- a gente configura a IA para cobrar só NR e R1.

### Subi e não sincronizou ⛔
Problema técnico. Referência para a equipe: conferir se o relatório certo está
na pasta certa e em XLSX, e forçar a sincronização.

---

## 2. Números de WhatsApp da IA e código de verificação (~32)

### Quais números providenciar ✅
São 2 números exclusivos para a IA:

- um para **cobrança e relacionamento**, que rodam juntos no mesmo número;
- um para o **Agente de Vendas**.

Pode ser chip de qualquer operadora, número fixo ou número virtual, desde que
receba SMS ou ligação.

### O número pode continuar com WhatsApp? ✅
Não. O número é registrado direto na API Oficial da Meta e **não pode ter conta
de WhatsApp** (nem no app normal, nem no Business). Desinstalar ou deslogar não
basta: é preciso **excluir a conta** do WhatsApp daquele número. Depois de
excluir, espere uns 5 minutos antes de tentarmos o cadastro. Depois do
cadastro, o número não precisa mais ficar num aparelho.

### Como é o cadastro ✅
A gente combina um horário com a unidade. Nesse horário, alguém precisa estar
**com o chip em mãos**. Enviamos um código por SMS (ou por ligação) e vocês nos
passam o código aqui no grupo. Ele expira rápido.

### O código não chegou ⚠️
- Confira se o número está certo.
- Chip novo precisa estar ativado, com recarga.
- Se a Meta acusar limite de envios, ela trava por um tempo: tentamos de novo
  mais tarde ou no dia seguinte.
- Se for linha virtual e o código não aparecer, acione o suporte do provedor.
- Reenviar o código é com a equipe, então o agente escala.

### Trocar um número já cadastrado ⚠️
A equipe retira o número antigo e cadastra o novo com um código. Para isso, é
preciso alguém com o chip novo em mãos. O agente escala.

---

## 3. OpenAI: conta e cartão (~26)

### Para que serve e como é criada ✅
É a conta da **plataforma de API da OpenAI**, que paga os "pensamentos" da IA.
**A assinatura do ChatGPT não serve**: é outra conta.

Como criar:

- A gente cria a conta, de preferência no e-mail da unidade. Pode ser outro
  e-mail de vocês, desde que ainda não tenha conta na OpenAI.
- Chega um código da OpenAI nesse e-mail e vocês nos passam aqui.
- Avisem quando puderem receber o código, porque ele expira rápido. Confiram
  também o spam.

### Como cadastrar o cartão ✅
1. Entre com o e-mail da conta.
2. Acesse `{link de billing da OpenAI}` e clique em "adicionar detalhes de
   pagamento".
3. Coloque o crédito inicial e configure a recarga automática. Os valores
   recomendados são passados pela equipe: pergunta sobre valores escala.
4. Confira no canto inferior esquerdo se está logado na conta certa.
5. Avise quando terminar.

O cartão precisa aceitar transações internacionais.

### Quanto custa por mês ⛔
Valores. Referência para a equipe: o custo depende do uso, em média de US$ 15 a
US$ 50 por mês, e o crédito inicial recomendado é de US$ 15, com recarga de
US$ 10 quando o saldo fica abaixo de US$ 5.

### Qual a diferença entre o cartão da OpenAI e o da Meta ⛔
Cobrança e valores. Referência para a equipe: a OpenAI é pré-paga e cobra os
tokens da IA. A Meta é pós-paga e cobra os disparos.

---

## 4. Meta: cartão, BM e limites (~45)

### Como cadastrar o cartão na Meta ✅
É a **última etapa da parte de vocês** antes de começar.

1. Abra `{link da central de cobrança da Meta}` num navegador em que o BM já
   esteja logado. O link cai direto na tela de cadastro.
2. Pode ser feito pelo Facebook de qualquer pessoa com acesso ao BM.
3. Tente colocar a moeda em real. Às vezes não dá e fica em dólar.
4. Se der erro (por exemplo, cartão já usado em outro BM), cadastre como
   **forma de pagamento da empresa**, em "Adicionar forma de pagamento da
   empresa". Depois a gente vincula.
5. Avise quando terminar, que a gente confere.

O cartão precisa aceitar transações internacionais.

### A Meta cobra todo dia? Quanto vai custar? ⛔
Cobrança e valores. Referência para a equipe: no começo a Meta cobra todo dia e
depois espaça as cobranças. O valor acompanha o volume de disparos. Na fatura
aparece como FACEBOOK ou META.

### Apareceu cobrança do Facebook no cartão ⛔
Cobrança e valores. Referência para a equipe: é a Meta cobrando os disparos, e
não a 7Bee.

### O pagamento na Meta foi recusado ⛔
Cobrança e problema técnico. Referência para a equipe: sem cartão válido os
disparos param. Conferir o limite ou cadastrar outro cartão como forma de
pagamento da empresa.

### O que é o BM e o que precisamos fazer ✅
O BM (portfólio de negócios da Meta) é onde ficam as contas de WhatsApp que
disparam as mensagens.

- **Se vocês já têm BM:** é só nos dar acesso. O BM precisa estar verificado e
  sem restrições.
- **Se nunca tiveram:** a gente cria, usando o Facebook pessoal de alguém da
  unidade (o BM não fica vinculado a esse perfil) e damos entrada na
  verificação do CNPJ.

### O convite do BM não chegou ✅
Normalmente o convite precisa ser aprovado por outro admin do mesmo BM. Confira
também o spam e a aba Social do e-mail. Se o convite expirar, é preciso
reenviar.

### Por que só ~250 disparos por dia? ⛔
Enquanto o BM está em verificação, a Meta limita a **250 mensagens por dia**.
Depois da aprovação, o limite sobe para cerca de 2 mil. Nos primeiros dias
também é normal a Meta deixar o número "em alerta": nesse período a gente reduz
a cobrança e aumenta o relacionamento, liberando as réguas aos poucos. A
situação exata do BM de cada unidade é com a equipe. O tema envolve cobrança,
então o texto acima serve só de referência para a equipe.

### Apareceu outra empresa como parceira no BM ✅
É a conta que conecta os nossos apps aos números de vocês, como um cabo de
conexão, e não afeta nada. Se aparecer outra empresa que vocês não reconhecem,
avisem.

### O código de login do Facebook não chega ✅
Ele aparece como notificação no aparelho em que a conta está conectada: abra o
app do Facebook e vá em Notificações. Também dá para receber por e-mail.

---

## 5. Onboarding: contrato, documentos, etapas e início (~37)

### Quais são as etapas ✅
1. **Documentação.** Preencha os dados no `{link de onboarding}`. O contrato
   chega por e-mail: assine pelo gov.br e suba junto com os documentos.
2. **Parametrização:**
   - conta na OpenAI com cartão;
   - acesso ao BM;
   - cadastro dos números;
   - cartão na Meta;
   - acesso ao CTN.
3. **Início:** sobe a primeira lista e os disparos começam.

O tempo de implantação depende diretamente da velocidade com que as etapas de
vocês são concluídas.

### Onde envio os documentos? Quais? ❓
Envie **somente pelo `{link de envio de documentos}`**: nunca no grupo, nem por
e-mail.

- Documentos: cartão CNPJ, contrato social, alvará e o contrato assinado.
- Documentos pessoais só do sócio que vai fazer a verificação facial.
- Várias pessoas podem subir arquivos pelo mesmo link.
- O próprio link mostra o que ainda falta.
- Não recebeu o e-mail do contrato? Olhe o spam. A gente também pode reenviar.

> **A confirmar.** A resposta cita o contrato só como documento a enviar, sem
> falar das cláusulas. Pode contar como "relacionado a contrato"?

### Falta alguma coisa? Quando começa? ⚠️
Resposta geral: quando tudo estiver concluído, a gente começa em até 48 horas.
Muitas vezes começa no dia seguinte, e no mesmo dia se a lista subir cedo.

A etapa que falta é diferente em cada unidade. O agente responde a parte geral
e escala.

**Integração com o CRM:** com o CRM, o agente consegue consultar em que etapa da
esteira a unidade está e responder de forma exata.

### Quando começa o período de teste de 60 dias? ❓
No primeiro dia em que os disparos começarem. A foto do grupo é trocada para
marcar esse início.

> **A confirmar.** O período de teste é uma condição do contrato.

### Podemos fazer uma reunião? ⚠️
Sim. A gente recomenda que a reunião seja no dia do início, ou depois dele, para
já ter dados reais. O horário é combinado com a equipe, então o agente escala.

---

## 6. Gateway de pagamento (AbacatePay) (~21) ⛔

> A conta do gateway existe para receber os pagamentos da cobrança. Só a
> verificação facial fica a confirmar.

### Quem faz a verificação facial (KYC)? ❓
**Basta um sócio**, quem conseguir fazer mais rápido, pelo `{link de
verificação}`.

- Pode ser um procurador, desde que envie o documento e uma procuração que dê
  direito de abrir contas.
- Se no final o botão "avançar" não habilitar, é assim mesmo: a gente repassa
  para o gateway.
- Se o gov.br bloquear a abertura de contas no seu nome, desative essa
  configuração no gov.br.
- Às vezes o gateway pede um segundo sócio. Quando pedir, a gente avisa.

### Para que serve a conta no gateway? ⛔
- É uma conta de recebimento **complementar**. O pagamento principal é pelo link
  de conciliação do CTN, que já cai conciliado.
- Os valores que entram pelo gateway (baixados no CTN como "DIRETO NO CARTÃO -
  CEF") ficam nessa conta.
- Para retirar esses valores, é preciso fazer saques periodicamente.

### Não consigo sacar / o código não chega no e-mail ⛔
O código de saque vem de um **aplicativo autenticador**, não do e-mail. Se ainda
não cadastraram o autenticador, é preciso cadastrar. Se outra pessoa já
cadastrou, peçam o código a ela.

### Entrei e não aparece valor ⛔
Provavelmente a conta está no modo teste: clique em "Ir para produção". Se der
erro, recarregue com Ctrl+Shift+R ou use uma janela anônima.

---

## 7. CTN, baixas e formas de pagamento (~32) ⛔

> Tudo aqui é cobrança. Os textos ficam só como referência para a equipe.

### Para que serve o acesso ao CTN (Gerente do Cartão)? ❓
É por esse acesso que a IA gera, na hora, o link de conciliação de cada cliente
e dá as baixas automáticas.

Como criar: um usuário **Operador de Adimplência** com o perfil **GERENTE DO
CARTÃO**. Selecione o perfil e clique em Gravar. O CPF a usar é informado pela
equipe.

### Como o cliente paga? ⛔
- Pelo link de conciliação da franqueadora, com cartão ou PIX. O pagamento cai
  conciliado no CTN.
- Pagamentos que entram por fora do link recebem baixa automática em poucos
  minutos.
- A IA sempre incentiva o pagamento no cartão com autorização das cobranças
  futuras. Ela não consegue obrigar o cliente a autorizar.
- Dá para tirar o PIX do link, mas pela nossa experiência o resultado cai
  bastante.

### Qual forma de pagamento a IA usa na baixa manual? ⛔
"DIRETO NO CARTÃO - CEF". Isso só acontece quando o link de conciliação falha e
o cliente paga pelo caminho antigo, e o dinheiro fica no gateway. A unidade pode
escolher outra forma de lançamento: é só avisar.

### A IA cobra só o que está em 3C? ⛔
Sim. Ela cobra o que está na lista de inadimplentes do BI. Cobra todas as
parcelas que o CTN libera; parcelas que ainda estão no motor de recorrência
entram depois, automaticamente.

### Cliente em dia recebendo cobrança / pagou e não teve baixa ⛔
A IA segue a lista do BI. Coisas para conferir:

- se o cliente estava na lista do dia;
- se há dependente em aberto no cadastro;
- se a lista subiu atrasada;
- se a mensagem é mesmo da IA (o número dela tem foto própria).

A equipe pede a **matrícula** para investigar.

### Excluir um cliente da cobrança ⛔
A exclusão é feita pela equipe, a partir da matrícula.

### Reembolso, estorno, pagamento duplicado ⛔
O agente escala (problema técnico). Referência: o reembolso pelo painel só
devolve o valor ao cliente, e a baixa no CTN é retirada pela unidade.

---

## 8. Dashboard e Chat CDT (~40)

### Como recebemos os acessos? ✅
- **Dashboard** (pagamentos, clientes em cobrança e desempenho do dia; indicado
  para gestão e financeiro): mande o e-mail de quem vai acompanhar.
- **Chat CDT** (conversas em tempo real; é onde a equipe assume quando a IA
  passa o atendimento): mande o **nome e o e-mail de cada pessoa que vai
  atender**. É um login por pessoa, para o histórico ficar organizado.

A gente cria e envia os logins com uma senha temporária. O sistema pede para
trocar no primeiro acesso. A senha criada no Dashboard vale também para o Chat.
O mesmo login dá acesso à área de Vendas do Chat.

O agente **nunca** envia login nem senha. Ele pede os e-mails e escala para a
equipe criar os acessos.

### Trocar ou desativar o acesso de alguém que saiu ⚠️
O agente pede o e-mail a desativar, o e-mail novo e se o acesso é para o
Dashboard, o Chat ou os dois. Depois escala.

### Quem aparece para a equipe atender no Chat? ✅
Aparecem os casos que a IA passa para a equipe:

- cliente que pede para falar com uma pessoa;
- cliente que xingou;
- cliente que quer cancelar;
- cliente que a IA não conseguiu contatar depois de algumas tentativas;
- pergunta que a IA não resolve;
- cliente que enviou comprovante.

Quem combinou uma data de pagamento só aparece quando a data chega.

### Só consigo atender 5 clientes por vez? ✅
Não há limite. Esse número é a quantidade de clientes que a IA repassou; os
outros ela resolveu sozinha.

### Notificações do Chat não aparecem ✅
Libere o pop-up de notificação do navegador. Se não aparecer, recarregue com
Ctrl+Shift+R.

### Preciso clicar em "assumir"? ✅
Não. Responder a conversa já assume o atendimento.

### A janela de 24h fechou. Como continuo a conversa? ✅
Use um dos templates pré-aprovados, no botão do meio do chat. O cliente precisa
responder ao template para a conversa continuar. Se não fizer sentido
continuar, encerre a conversa como não resolvida.

### O que é o valor de baixo no Dashboard? ⛔
É a projeção de recebimento do mês. No primeiro mês ela fica baixa, porque
considera o começo do mês zerado. Com meses completos, ela fica precisa.

### O que significa "Concluiu (declarado)"? ⛔
O cliente disse que já pagou ou mandou comprovante. O status muda quando a IA
confirma o pagamento no CTN.

### Página estranha / não consigo entrar ⚠️
Recarregue a página e tente a senha do Dashboard. Se continuar, mande um print:
o agente escala (problema técnico).

---

## 9. Como a IA de cobrança e relacionamento funciona (~29)

> Tudo o que é da cobrança escala. Sobre o relacionamento e os ajustes no que a
> IA fala, o agente responde.

### Quantas mensagens a IA manda por dia? ⛔
Até 4, conforme a régua e a estratégia. Quando o cliente responde, os disparos
param e a IA passa a conversar com ele. Se o cliente tem uma experiência
negativa (xingou, por exemplo), a IA se bloqueia e não contata mais esse
cliente.

### O que é cada régua? ⛔
Segue o padrão do BI: régua 1 é 1 mensalidade em aberto, régua 2 são 2
mensalidades, e assim por diante. Cada régua tem uma abordagem própria. A gente
libera as réguas aos poucos para proteger o BM.

### A IA faz ligação? ⛔
Não. Ela atua só pelo WhatsApp.

### A IA dá desconto ou faz promoção? ⛔
Por princípio não: a régua é feita para recuperar o valor integral. De vez em
quando oferecemos campanhas pontuais com adesão opcional, como a Desenrola
(seção 11).

### O que a IA envia no relacionamento? ✅
Benefícios do Cartão de TODOS e comunicações da unidade, variando entre os
clientes. Depois dos 60 dias, a unidade pode mandar campanhas locais.

### A IA pode divulgar um benefício ou parceria da unidade? ✅
Mande o material completo e a gente inclui no conhecimento da IA: ela passa a
explicar o benefício quando o cliente perguntar. O envio ativo para a base de
clientes a gente avalia com vocês.

### Podemos ajustar o que a IA fala? ✅
Sim. Mande aqui um print do que soou diferente do que vocês praticam (preço,
regra, jeito de falar) e a gente ajusta. Quanto mais material da unidade vocês
mandarem (especialidades, regras, o que fazer quando não tem uma especialidade),
mais completa a IA fica.

### Dá para reduzir a quantidade de mensagens? ⛔
A gente pode testar, mas a tendência é o resultado cair. Pedido de mudança de
estratégia vai para a equipe, então o agente escala.

### O resultado está baixo / tivemos problema hoje? ⛔
O agente escala (reclamação ou problema técnico). Referência para a equipe:
as causas comuns são atraso do BI, limite de disparos da Meta e instabilidade
do servidor.

---

## 10. Agente de Vendas (~36)

### O que é preciso para ligar ✅
1. **Link de filiação da IA:** no CTN, cadastre um promotor de vendas só para a
   IA, com o nome **AGENTE IA VENDAS**, e mande o link de filiação dele. Se o
   CPF der conflito, use o CPF de alguém que não seja cliente do Cartão de
   TODOS.
2. **Regras da unidade:**
   - valor da consulta com clínico geral e com especialista;
   - multa por cancelar antes de 12 meses;
   - regras de dependentes (idade dos pais, limite, custo da carteirinha);
   - se tem odontologia com desconto.
3. **Quem vai testar:** nome e e-mail.

A gente liga em 1 a 2 dias.

### Como testar ✅
1. Salve o contato do agente.
2. Duas ou mais pessoas conversam com ele como se fossem clientes vindos do
   anúncio. Mande **#zerar** para recomeçar do zero.
3. O que soar diferente do que vocês praticam, mande print aqui no grupo.
4. As conversas ficam na área de Vendas do Chat CDT, com o login de sempre.
5. Com o ok de vocês, os anúncios são ligados.

### Como ele vende ✅
- Vende só pelo link de filiação dele, com cartão de crédito ou débito.
- Tudo que foge da regra ele passa para a equipe.
- Tem follow-up quando o cliente para de responder.
- Atende inclusive depois das 18h.
- Por enquanto não faz contato ativo.

### Vocês fazem o tráfego pago? ✅
Não. O gestor de tráfego da unidade duplica as campanhas que já usa e direciona
para o número da IA. A gente recomenda dividir a verba 50/50 entre equipe e IA,
com anúncios e públicos iguais (um teste A/B). A verba é da unidade e o valor
fica a critério de vocês. Para seguir, a gente precisa falar com quem cuida do
tráfego.

---

## 11. Campanha Desenrola 7Bee (~11) ⛔

> É uma campanha de cobrança com desconto, então tudo escala. O texto fica só
> como referência para a equipe.

### Como funciona ⛔
É uma ação pontual de 3 dias, no fim do mês, para recuperar a inadimplência mais
antiga:

- as réguas mais antigas quitam por um valor menor;
- NR e as réguas 1 e 2 seguem sem desconto.

O pagamento é pelo link do CTN, e a baixa quita todas as mensalidades em aberto.
**A adesão é opcional**: sem o aceite da unidade, nada muda. Para aderir,
respondam no grupo **ACEITO A CAMPANHA DESENROLA** dentro do prazo do
comunicado.

O agente **não cita valores de quitação nem datas**: remete ao comunicado da
edição. Pedido para mudar valores ou condições é ⚠️ e vai para a equipe.

---

## Sempre escalar (⛔) — exemplos reais do histórico

| Regra | Exemplos que apareceram |
| --- | --- |
| Cobrança | tudo da cobrança feita pela IA: réguas, disparos aos inadimplentes, pagamentos, baixas, reembolso, descontos, Campanha Desenrola, gateway |
| Valores | qualquer valor ou custo: mensalidade e repasse da 7Bee, fechamento mensal, custos da OpenAI e da Meta, preço de número, valores de campanha |
| Contrato | o que acontece se a solução parar de funcionar; prazo e adendo depois dos 60 dias |
| Cancelamento | a unidade quer cancelar ou pausar o serviço |
| Reclamação | resultado abaixo do esperado; excesso de mensagens gerando desfiliação; IA cobrando quem já tinha negociado com a equipe |
| Problema técnico | pagamento sem baixa; reembolso ou estorno; conversa marcada como cancelamento sem pedido; erro ou lentidão no Dashboard, no Chat ou no gateway; template com texto estranho |

Quando escala, o agente não escreve nada no grupo. Ele registra no CRM com o
motivo, e a mensagem aparece para o Guilherme em **Precisam de você**.

---

## O que falta responder

Estas perguntas apareceram nos grupos sem resposta em texto: foram respondidas
em áudio ou ficaram sem retorno. O Guilherme precisa completar antes de o agente
usar.

1. A própria unidade consegue enviar um template para reabrir a conversa depois
   de 24h? Onde fica isso no Chat?
2. O tom do chat está pessoal demais em algumas mensagens. Dá para mudar?
3. A IA pode informar que a unidade tem especialidades em outros locais?
4. Clientes que combinaram uma data de pagamento continuam recebendo disparos
   ou vão para o time?
5. Qual CPF deve ser cadastrado no acesso ao CTN?
6. Os pagamentos recebidos pela IA caem em qual instituição? Quem da unidade
   pode fazer os saques? Dá para usar o mesmo e-mail em outra unidade?
7. Sócios que saíram do quadro societário: o documento enviado considerou isso?
8. Leads do Agente de Vendas chegam, mas não fecham. O que fazer?
9. Como funciona, no dia a dia, o Agente de Vendas junto com o tráfego pago?
10. Dá para trocar o link de filiação usado pelo Agente de Vendas?
11. A unidade não quer dar acesso ao Power BI. Qual é a alternativa?

## Pontos para o Guilherme confirmar

- **Os itens ❓ deste documento:** a rotina das planilhas, o envio de
  documentos e contrato, o período de teste, a verificação facial do gateway e o
  acesso ao CTN. São "relacionados a cobrança ou contrato"?
- **Gateway obrigatório?** No começo do histórico, a aprovação da AbacatePay era
  pré-requisito para começar. Com o acesso ao CTN, ela passou a ser
  complementar. Confirmar a regra atual.
- **Limite de disparos.** 250 por dia com o BM em análise e cerca de 2 mil
  depois. Ainda vale?
- **Sábados.** Uma resposta diz que a lista de sábado não é obrigatória e outra
  que há cobrança no dia. Confirmar.
- **Feriados.** "Estratégia reduzida, em teste". Já existe uma regra definida?
