-- Carga inicial das franquias CDT na esteira de onboarding.
--
-- O banco saiu do SQLite para o Supabase vazio, então as franquias precisam
-- entrar de novo. São os 32 grupos CDT do WhatsApp do Guilherme (instância
-- Guilherme-7Bee na Evolution, lida em 30/09/2026), sem o "CDT.IA - Gestão",
-- que é interno. Mesma regra da carga inicial em docs/WHATSAPP.md:
--
--   - Barra de São Francisco, Aracruz e Guriri estão começando: entram em
--     Nova franquia, com as quatro tarefas pendentes, e o prazo de 5 dias
--     conta da criação do grupo.
--   - As outras 29 já terminaram: entram em Concluído, com as tarefas feitas e
--     o selo "Antes do CRM" (fora da meta de 5 dias e da média).
--
-- Faz o mesmo que `npm run importar:whatsapp -- --confirmar --etapa=concluido
-- --nova="aracruz|guriri|barra de s[aã]o francisco"`: cada franquia ganha
-- as tarefas, o contato (tag franquia, cliente ativo) e o histórico. O link de
-- convite dos grupos não vai para o Git; cole em Editar dados quando precisar.
--
-- Aplicar à mão no SQL Editor do projeto. Rodar de novo não duplica: grupo que
-- já está na esteira é pulado.

do $$
declare
  g         record;
  franquia  bigint;
  contato   bigint;
begin
  for g in
    select * from (values
    ('120363430352499581@g.us', 'CDT - Barra de São Francisco ES', 'Barra de São Francisco ES', timestamptz '2026-08-26 20:12:28+00', 'nova'),
    ('120363412594885372@g.us', 'CDT - Aracruz', 'Aracruz', timestamptz '2026-08-26 20:16:45+00', 'nova'),
    ('120363427650826414@g.us', 'CDT - Guriri ES', 'Guriri ES', timestamptz '2026-08-31 18:40:59+00', 'nova'),
    ('120363386128924914@g.us', 'CDT.IA - Ibirité', 'Ibirité', timestamptz '2025-02-17 19:32:04+00', 'concluido'),
    ('120363405412385735@g.us', 'CDT.IA - Cabo Frio', 'Cabo Frio', timestamptz '2025-10-02 16:59:33+00', 'concluido'),
    ('120363423471176566@g.us', 'CDT.IA - Três Corações', 'Três Corações', timestamptz '2026-02-04 13:58:56+00', 'concluido'),
    ('120363423547176204@g.us', 'CDT.IA - Pouso Alegre', 'Pouso Alegre', timestamptz '2026-02-06 14:49:19+00', 'concluido'),
    ('120363423340455330@g.us', 'CDT.IA - Varginha', 'Varginha', timestamptz '2026-02-06 14:50:51+00', 'concluido'),
    ('120363424383984642@g.us', 'CDT.IA - Porto Alegre', 'Porto Alegre', timestamptz '2026-02-06 14:58:32+00', 'concluido'),
    ('120363426356039699@g.us', 'CDT - Sapopemba', 'Sapopemba', timestamptz '2026-04-13 15:38:54+00', 'concluido'),
    ('120363408589877748@g.us', 'CDT - Tatuapé', 'Tatuapé', timestamptz '2026-04-13 18:42:45+00', 'concluido'),
    ('120363423921416453@g.us', 'CDT - Vitória', 'Vitória', timestamptz '2026-04-13 18:44:50+00', 'concluido'),
    ('120363425270036478@g.us', 'CDT - Mogi', 'Mogi', timestamptz '2026-04-13 18:45:39+00', 'concluido'),
    ('120363425376786636@g.us', 'CDT - Caraguatatuba', 'Caraguatatuba', timestamptz '2026-04-14 15:32:38+00', 'concluido'),
    ('120363410277833081@g.us', 'CDT - Patrocínio', 'Patrocínio', timestamptz '2026-04-20 14:52:25+00', 'concluido'),
    ('120363425204852493@g.us', 'IA CDT - Campo Limpo', 'Campo Limpo', timestamptz '2026-04-29 17:31:48+00', 'concluido'),
    ('120363425280201555@g.us', 'CDT - Itaguaí RJ', 'Itaguaí RJ', timestamptz '2026-07-01 16:33:33+00', 'concluido'),
    ('120363411298847696@g.us', 'CDT - Formiga MG', 'Formiga MG', timestamptz '2026-07-08 13:04:18+00', 'concluido'),
    ('120363411833357234@g.us', 'CDT - São João Del Rey MG', 'São João Del Rey MG', timestamptz '2026-07-08 13:06:25+00', 'concluido'),
    ('120363429416535119@g.us', 'CDT - BH Oeste', 'BH Oeste', timestamptz '2026-07-13 23:02:58+00', 'concluido'),
    ('120363429965899307@g.us', 'CDT - Colatina ES', 'Colatina ES', timestamptz '2026-08-06 19:43:35+00', 'concluido'),
    ('120363428239419081@g.us', 'CDT - Pará de Minas', 'Pará de Minas', timestamptz '2026-08-06 21:16:01+00', 'concluido'),
    ('120363428361723150@g.us', 'CDT - Itaúna MG', 'Itaúna MG', timestamptz '2026-08-06 21:17:05+00', 'concluido'),
    ('120363430953041596@g.us', 'CDT - Mariana', 'Mariana', timestamptz '2026-08-08 12:57:27+00', 'concluido'),
    ('120363415122455640@g.us', 'CDT - Itapecerica da Serra', 'Itapecerica da Serra', timestamptz '2026-08-14 14:45:07+00', 'concluido'),
    ('120363429709115167@g.us', 'CDT - Maricá RJ', 'Maricá RJ', timestamptz '2026-08-20 15:25:01+00', 'concluido'),
    ('120363425761329510@g.us', 'CDT - Araruama', 'Araruama', timestamptz '2026-08-20 15:45:17+00', 'concluido'),
    ('120363413357180906@g.us', 'CDT - BH Venda Nova', 'BH Venda Nova', timestamptz '2026-08-20 19:47:57+00', 'concluido'),
    ('120363427816597686@g.us', 'CDT - Teixeira de Freitas BA', 'Teixeira de Freitas BA', timestamptz '2026-08-26 20:14:28+00', 'concluido'),
    ('120363410894644557@g.us', 'CDT - Linhares ES', 'Linhares ES', timestamptz '2026-08-26 20:15:31+00', 'concluido'),
    ('120363413309101804@g.us', 'CDT - Freguesia do Ó', 'Freguesia do Ó', timestamptz '2026-08-27 14:19:50+00', 'concluido'),
    ('120363430003674163@g.us', 'CDT - Sete Lagoas', 'Sete Lagoas', timestamptz '2026-08-28 01:32:37+00', 'concluido')
    ) as t(group_id, group_name, nome, criado_em, etapa)
  loop
    continue when exists (select 1 from crm.onboardings where whatsapp_group_id = g.group_id);

    insert into crm.onboardings (franchise_name, owner, stage, origem, whatsapp_group_id,
                                 whatsapp_group_name, started_at)
    values (g.nome, 'Guilherme', 'nova', 'whatsapp', g.group_id, g.group_name, g.criado_em)
    returning id into franquia;

    insert into crm.onboarding_tasks (onboarding_id, task_key, title, position) values
      (franquia, 'openai',       'Cadastro na OpenAI',        0),
      (franquia, 'bm_facebook',  'Criação de BM no Facebook', 1),
      (franquia, 'ctn',          'CTN',                       2),
      (franquia, 'teste_agente', 'Teste do agente de vendas', 3);

    insert into crm.activities (onboarding_id, kind, detail, actor)
    values (franquia, 'onboarding_criado', g.nome || ' (whatsapp)', 'whatsapp');

    -- Contato da franquia: reaproveita o que já tem a franquia como empresa.
    select id into contato from crm.contacts where lower(company) = lower(g.nome) order by id limit 1;
    if contato is null then
      insert into crm.contacts (name, company, phone, stage, owner, tags, is_customer)
      values (g.nome, g.nome, '', 'cliente', 'Guilherme', 'franquia', true)
      returning id into contato;
      insert into crm.activities (contact_id, onboarding_id, kind, detail, actor)
      values (contato, franquia, 'contato_criado', g.nome || ' (franquia ' || g.nome || ')', 'whatsapp');
    else
      update crm.contacts set is_customer = true,
        owner = case when coalesce(owner, '') = '' then 'Guilherme' else owner end,
        tags = case when tags like '%franquia%' then tags
                    when tags = '' then 'franquia'
                    else tags || ', franquia' end,
        updated_at = now()
      where id = contato;
    end if;
    update crm.onboardings set contact_id = contato where id = franquia;

    if g.etapa = 'concluido' then
      update crm.onboarding_tasks set status = 'feito', done_at = now(), updated_at = now()
      where onboarding_id = franquia;
      update crm.onboardings set stage = 'concluido', stage_changed_at = now(), concluded_at = now(),
                                 fora_da_meta = true, updated_at = now()
      where id = franquia;
      insert into crm.activities (onboarding_id, kind, detail, actor) values
        (franquia, 'onboarding_etapa', g.nome || ' → Concluído', 'importação da Evolution'),
        (franquia, 'onboarding_meta', g.nome || ': concluída antes do CRM, fora da meta de 5 dias', 'importação da Evolution');
    end if;
  end loop;
end $$;

-- Conferência: deve mostrar concluido 29 e nova 3.
select stage, count(*) from crm.onboardings where whatsapp_group_name ~* 'cdt' group by stage order by stage;
