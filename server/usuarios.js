/**
 * Usuários do CRM, pelo terminal do servidor.
 *
 *   npm run usuario -- criar guilherme@7bee.com --nome Guilherme
 *   npm run usuario -- senha guilherme@7bee.com      troca a senha
 *   npm run usuario -- listar
 *   npm run usuario -- desativar guilherme@7bee.com
 *   npm run usuario -- ativar guilherme@7bee.com
 *
 * A senha é pedida na hora e não aparece na tela nem fica no histórico do
 * terminal. O login do CRM passa a valer assim que existe o primeiro usuário.
 */
import { createInterface } from 'node:readline';
import { criarUsuario, trocarSenha, listarUsuarios, ativarUsuario } from './auth.js';

const [acao, email, ...resto] = process.argv.slice(2);
const opcao = (nome) => { const i = resto.indexOf(`--${nome}`); return i >= 0 ? resto[i + 1] : undefined; };

function perguntarSenha(texto) {
  if (process.env.CRM_NOVA_SENHA) return Promise.resolve(process.env.CRM_NOVA_SENHA);
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => { if (s.includes(texto)) process.stdout.write(s); }; // não ecoa o que é digitado
    rl.question(texto, (resposta) => { rl.close(); process.stdout.write('\n'); resolve(resposta); });
  });
}

async function novaSenha() {
  const a = await perguntarSenha('Senha: ');
  if (!process.env.CRM_NOVA_SENHA) {
    const b = await perguntarSenha('Repita a senha: ');
    if (a !== b) throw new Error('As senhas não conferem.');
  }
  if (a.length < 8) console.log('Aviso: senha curta. Com o CRM aberto na internet, prefira 8 caracteres ou mais.');
  return a;
}

try {
  if (acao === 'criar' && email) {
    const u = criarUsuario({ email, nome: opcao('nome'), senha: await novaSenha() });
    console.log(`Usuário criado: ${u.nome} <${u.email}>. O login do CRM está ligado.`);
  } else if (acao === 'senha' && email) {
    const u = trocarSenha(email, await novaSenha());
    console.log(`Senha trocada para ${u.email}. As sessões abertas foram encerradas.`);
  } else if (acao === 'listar') {
    const lista = listarUsuarios();
    if (!lista.length) console.log('Nenhum usuário: o CRM está sem login.');
    for (const u of lista) console.log(`${u.ativo ? 'ativo   ' : 'inativo '} ${u.email.padEnd(32)} ${u.nome.padEnd(16)} último acesso: ${u.ultimo_acesso ?? '—'}`);
  } else if ((acao === 'desativar' || acao === 'ativar') && email) {
    const u = ativarUsuario(email, acao === 'ativar');
    console.log(`${u.email} ${u.ativo ? 'ativado' : 'desativado'}.`);
  } else {
    console.log('Uso: npm run usuario -- criar <email> [--nome Nome] | senha <email> | listar | desativar <email> | ativar <email>');
    process.exit(1);
  }
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
