# Backlog de comandos pendentes — extração exaustiva

Lista de trabalho (não é documentação final) para orientar os próximos lotes de inserção no banco de comandos, criada em 2026-07-21.

## Progresso

- **Lote 6 (2026-07-21):** inseridos `fwacceldos` (fwaccel dos config/stats, p. 1478-1546) e `fwctlmultik` (fw ctl multik stat/queues/utilize, p. 1718-1746) no tópico `securexl`. Banco: 55 → 57 comandos.
- **Lote 7 (2026-07-21):** inseridos `cpwdadmin` (cpwd_admin list, contexto Security Gateway, p. 1057-1090) no tópico `system`, e `cprinstallget` (cprinstall get/verify, contexto SMS, p. 189-208) no tópico `management` — com nota sobre `cprinstall install` não ser suportado em Gaia OS. Banco: 57 → 59 comandos.
- **Correção pós-Lote 6/7:** uma varredura de duplicidade em TODO o banco (não só no tópico do lote) achou que `fwacceldos` duplicava `fwaccel dos stats get` já existente em `fwaccel-adv`, e `cpwdadmin` duplicava `cpwd_admin list` já existente em `watchdog`. Os dois cards novos foram descartados e o conteúdo genuinamente novo (`fwaccel dos config get`, `cpwd_admin list -full`) foi incorporado nos cards existentes. Mesma correção aplicada a `fwctlmultik` (mesclado em `corexl`, que já tinha `fw ctl multik stat`). **Lição:** todo lote agora inclui uma varredura de `command_lines` duplicadas no banco inteiro antes de finalizar, não só checar por `id`. Banco final após correções: 57 comandos.
- **Lote 8 (2026-07-21):** ClusterXL já estava bem coberto (`env-cluster`: cphaprob state/-a if/list, fw hastat, clusterXL_admin, show_bond). CoreXL (`corexl`) enriquecido com `fw ctl multik queues`/`utilize` (fundidos, ver correção acima). Adicionado `mqmng` (mq_mng -o -v — configuração de Multi-Queue, tópico `securexl`, p. 1786-1793), que não existia ainda. Banco: 57 → 58 comandos.
- **Lote 9 (2026-07-21):** o capítulo "Gaia Commands" (p. 40) do CLI Reference Guide NÃO tem conteúdo próprio — só aponta para o "R82 Gaia Administration Guide" e o "R82 Gaia Advanced Routing Administration Guide", nenhum dos dois enviado. `CCSA-R81.20-Student-Lab-Manual.pdf` (906 páginas) é só imagens/screenshots — `pdftotext`/`pdffonts` não extraem nenhum texto (precisaria de OCR, risco de erro de sintaxe). Em vez disso, extraí o `R81.20_Maestro_CLI_Cheat_v07.cleaned.pdf` (4 páginas, texto limpo) por completo e adicionei ao `env-maestro` os comandos genuinamente novos que não estavam lá: `asg_provision` (consistência de build/hotfix no Security Group), `asg_conns -b <SGM_ID>` (conexões por SGM) e `fw dbgfile collect` (debug do Security Group via gClish). Banco: 57 (sem novo card — conteúdo incorporado ao card já existente).
- **Pendência real de Gaia:** para cobrir comandos Gaia/clish além do que já existe em `env-gaia`, seria necessário o Gaia Administration Guide (não enviado) ou aceitar OCR do Lab Manual (não recomendado sem revisão manual da sintaxe).
- **Lote 10 (2026-07-21):** inseridos `contractutil` (contract_util check/print — elegibilidade de upgrade e cobertura do Contrato de Serviço, p. 50-58, tópico `license`) e `migrateserver` (migrate_server export/import — backup/restore do banco de gestão do SMS, p. 393-405, tópico `management`). `cp_conf` (admin/auto/ca/client/finger/lic) e `LSMcli` (~40 subcomandos, gestão SmartLSM/ROBO) ficaram de fora deste lote: `cp_conf` é majoritariamente reconfiguração do wizard inicial (baixo valor para troubleshooting do dia a dia) e `LSMcli` só se aplica a ambientes com SmartLSM/Multi-Domain gerenciando dezenas de Small Office Appliances — nicho demais para priorizar sem confirmação de que o ambiente do usuário usa isso. Banco: 57 → 59 comandos.
- **Varredura dos outros 6 documentos (2026-07-21):** conferido o que cada um realmente contém:
  - `CCSA-R81.20-Student-Lab-Manual.pdf` (906 pág.) — só imagens/screenshots, zero texto extraível (`pdffonts` não encontra nenhuma fonte). Precisaria de OCR.
  - `CCSA-R81.20-V1.0-1-Instructor-Slides.pptx` (511 slides) — só ~97 mil caracteres de texto no total (slides de arquitetura/conceito, bem pouco texto por slide) e apenas 1 menção a algo parecido com comando CLI. Sem valor prático para extração.
  - `CCSA-R82-Exam-Prep-Guide.pdf` e `CCSE-R82-Exam-Prep-Guide.pdf` — são guias de preparação para a prova (custo, domínios do exame, dicas de estudo), não contêm nenhum comando CLI.
  - `CP_R81.20_Quantum_Maestro_AdminGuide.cleaned.pdf` (541 pág.) — texto real e denso, ~110 blocos de sintaxe/prompt Expert encontrados. **Ainda não minerado — candidato ao próximo lote (Lote 11).**
  - `R81.20_Maestro_CLI_Cheat_v07.cleaned.pdf` (4 pág.) — já extraído por completo no Lote 9.
- **Lote 11 (2026-07-21):** minerado o `CP_R81.20_Quantum_Maestro_AdminGuide.cleaned.pdf` (541 páginas) — adicionadas ao `env-maestro` mais 5 linhas genuinamente novas: `asg policy verify -a -v` (consistência de política entre SGMs), `asg_mac_resolver` (diagnóstico de MAC/SGM/interface), `asg_config save` (backup da config gClish), `show distribution status`/`show distribution verification` (saúde da distribuição de tráfego). Banco seguiu em 59 comandos (sem card novo — tudo incorporado ao card já existente, que agora tem 28 linhas). **Nota de UX:** o card `env-maestro` está ficando bem extenso — pode valer a pena, no futuro, dividi-lo em 2-3 cards temáticos (ex.: "Execução global", "Distribuição de tráfego", "Diagnóstico") em vez de continuar empilhando tudo num só.
- **Lote 12 (2026-07-21):** voltando ao CLI Reference Guide. Enriquecido `identity-adlog` com `adlog a query user/ip` (busca na base de identidades, p. 1797-1812). Adicionado `vpnoverlap` (vpn overlap_encdom — detecção de domínios de criptografia VPN sobrepostos, causa clássica de túnel Site-to-Site que não sobe ou erro de multiple entry points, p. 1938-1940), novo card no tópico `vpn`. Banco: 59 → 60 comandos.
- **Mudança de escopo (2026-07-21):** o usuário esclareceu que quer TODOS os comandos, com descrição clara — o filtro/curadoria fica por conta da aplicação (busca/filtros já existentes), não da seleção do que entra no banco. A partir daqui, parar de escolher só os "mais valiosos" e processar o backlog de forma mais sistemática/completa.
- **Lote 13 (2026-07-21):** processado o capítulo "Security Gateway Commands" (p. 961-1057) quase por completo. Inseridos: `connview` (conexões USFW, tópico tables), `cppcap` (captura moderna, tópico capture), `cpconf` (cp_conf consolidado, tópico system), `cpprodutil` (registro de produtos CP, tópico system), `cpsdwan` (política SD-WAN, tópico routing), `domainstool` (resolução de objetos Domain, tópico routing), `dynamicobjects` (objetos dinâmicos, tópico policy), `cpmonitor` (análise de pcap, tópico capture), `connectionpipelining` (HyperFlow, tópico securexl), `bootsecpolicy` (comp_init_policy/control_bootsec, tópico policy). `cpstart`/`cpstop` já existiam no card `services` — o detalhe novo (-fwflag -proc) foi incorporado lá em vez de criar card duplicado. Banco: 60 → 70 comandos.
- **Diretriz confirmada (2026-07-21):** incluir TODAS as variações de cada comando (consulta/get/show, alteração/set, exclusão/del, start, stop, status etc.), cobrindo todas as versões. Nota: `command_versions` segue vazio para praticamente todo comando — a sintaxe é estável entre R81.10/R81.20/R82 na fonte oficial; diferenças reais entre versões (quando existem) já eram registradas via `command_diffs` por comando, não por duplicar o card inteiro. **(Atualização 2026-08-14: a feature `command_diffs`/"Differences by version" foi removida por completo do app — ver commit "Remover raw_template, 'Differences by version' e requires_ips". Este item do log é histórico; eventuais diferenças de versão futuras precisarão de outra abordagem, ex.: cards separados ou nota no campo Notes.)**
- **Lote 14 (2026-07-21):** fechado o capítulo "Common Commands" (cpinfo, hcp — cpview já existia no card `status`). Adicionado `fw sam_policy` (add/del/get/batch — editor de regras SAM/Rate Limiting que sobrevive a reboot, diferente do `fw sam` clássico), tópico `policy`. Banco: 70 → 73 comandos.
- Ainda faltam ~385 entradas só do CLI Reference Guide, mais os outros 6 documentos (Lab Manual, Slides, 2 Exam Prep Guides, Maestro AdminGuide, Maestro CLI Cheat Sheet) — ver tarefas #102-#106 na lista de tarefas do projeto.
- Muitas entradas do sumário abaixo são subcomandos triviais/raros (ex.: `fwaccel dos ioc_deny_ext`, `cpwd_admin monitor_list`) que talvez não valham um card próprio — avaliar caso a caso, agrupando como já feito aqui (vários subcomandos relacionados em 1 card, no estilo dos cards existentes).

## Fonte 1: CP_R82_CLI_ReferenceGuide.cleaned.pdf (2204 páginas)

O sumário do documento lista **415 comandos/subcomandos distintos**. Apenas 55 comandos existem hoje no banco (`server/commands.db`), cobrindo os tópicos: capture, debug, dlp, environment, identity, ips, license, logs, management, mobile, policy, qos, routing, securexl, status, system, tables, vpn.

Números de página abaixo = página impressa do PDF = página real do arquivo (offset 0, confirmado).

Uso: `pdftotext -layout -f <pagina_inicio> -l <pagina_fim> CP_R82_CLI_ReferenceGuide.cleaned.pdf saida.txt` para extrair o texto de um comando antes de escrever a entrada no banco (nunca inventar sintaxe).

### Lista completa (nome — página)

- `cpinfo` — p. 41
- `cpview` — p. 42
- `hcp` — p. 44
- `contract_util` — p. 50
- `contract_util check` — p. 52
- `contract_util cpmacro` — p. 53
- `contract_util download` — p. 54
- `contract_util mgmt` — p. 56
- `contract_util print` — p. 57
- `contract_util summary` — p. 58
- `contract_util update` — p. 59
- `contract_util verify` — p. 60
- `cp_conf` — p. 61
- `cp_conf admin` — p. 65
- `cp_conf auto` — p. 68
- `cp_conf ca` — p. 70
- `cp_conf client` — p. 72
- `cp_conf finger` — p. 76
- `cp_conf lic` — p. 78
- `cp_log_export` — p. 82
- `cpca_client` — p. 103
- `cpca_client create_cert` — p. 105
- `cpca_client double_sign` — p. 107
- `cpca_client get_crldp` — p. 109
- `cpca_client get_pubkey` — p. 111
- `cpca_client init_certs` — p. 112
- `cpca_client lscert` — p. 113
- `cpca_client recreate_crls` — p. 116
- `cpca_client revoke_cert` — p. 117
- `cpca_client revoke_non_exist_cert` — p. 120
- `cpca_client search` — p. 121
- `cpca_client set_ca_services` — p. 124
- `cpca_client set_cert_validity` — p. 126
- `cpca_client set_mgmt_tool` — p. 127
- `cpca_client set_sign_hash` — p. 132
- `cpca_create` — p. 134
- `cpconfig` — p. 135
- `cplic` — p. 138
- `cplic check` — p. 141
- `cplic contract` — p. 143
- `cplic db_add` — p. 145
- `cplic db_print` — p. 147
- `cplic db_rm` — p. 149
- `cplic del` — p. 150
- `cplic del <object name>` — p. 151
- `cplic get` — p. 152
- `cplic print` — p. 154
- `cplic put` — p. 157
- `cplic put <object name>` — p. 160
- `cplic upgrade` — p. 163
- `cppkg` — p. 172
- `cppkg add` — p. 174
- `cppkg delete` — p. 175
- `cppkg get` — p. 177
- `cppkg getroot` — p. 178
- `cppkg print` — p. 179
- `cppkg setroot` — p. 180
- `cpprod_util` — p. 181
- `cprid` — p. 188
- `cprinstall` — p. 189
- `cprinstall boot` — p. 192
- `cprinstall cprestart` — p. 193
- `cprinstall cpstart` — p. 194
- `cprinstall cpstop` — p. 195
- `cprinstall delete` — p. 196
- `cprinstall get` — p. 197
- `cprinstall install` — p. 198
- `cprinstall revert` — p. 201
- `cprinstall show` — p. 202
- `cprinstall snapshot` — p. 203
- `cprinstall transfer` — p. 204
- `cprinstall uninstall` — p. 206
- `cprinstall verify` — p. 208
- `cpstart` — p. 210
- `cpstat` — p. 211
- `cpstop` — p. 221
- `cpwd_admin` — p. 222
- `cpwd_admin config` — p. 226
- `cpwd_admin del` — p. 231
- `cpwd_admin detach` — p. 233
- `cpwd_admin exist` — p. 235
- `cpwd_admin flist` — p. 236
- `cpwd_admin getpid` — p. 238
- `cpwd_admin kill` — p. 239
- `cpwd_admin list` — p. 240
- `cpwd_admin monitor_list` — p. 245
- `cpwd_admin start` — p. 246
- `cpwd_admin start_monitor` — p. 249
- `cpwd_admin stop` — p. 250
- `cpwd_admin stop_monitor` — p. 252
- `dbedit` — p. 253
- `evstart` — p. 266
- `evstop` — p. 267
- `fw` — p. 268
- `fw fetchlogs` — p. 270
- `fw hastat` — p. 274
- `fw kill` — p. 275
- `fw log` — p. 276
- `fw logswitch` — p. 286
- `fw lslogs` — p. 290
- `fw mergefiles` — p. 293
- `fw repairlog` — p. 296
- `fw sam` — p. 297
- `fw sam_policy` — p. 305
- `fw sam_policy add` — p. 308
- `fw sam_policy batch` — p. 321
- `fw sam_policy del` — p. 323
- `fw sam_policy get` — p. 326
- `fwm` — p. 332
- `fwm dbload` — p. 335
- `fwm exportcert` — p. 336
- `fwm fetchfile` — p. 337
- `fwm fingerprint` — p. 339
- `fwm getpcap` — p. 341
- `fwm ikecrypt` — p. 343
- `fwm load` — p. 344
- `fwm logexport` — p. 345
- `fwm mds` — p. 350
- `fwm printcert` — p. 352
- `fwm sic_reset` — p. 358
- `fwm snmp_trap` — p. 359
- `fwm unload` — p. 362
- `fwm ver` — p. 366
- `fwm verify` — p. 367
- `inet_alert` — p. 368
- `ldapcmd` — p. 371
- `ldapcompare` — p. 373
- `ldapmemberconvert` — p. 377
- `ldapmodify` — p. 383
- `ldapsearch` — p. 385
- `mgmt_cli` — p. 388
- `migrate` — p. 389
- `migrate_server` — p. 393
- `queryDB_util` — p. 402
- `rs_db_tool` — p. 403
- `sam_alert` — p. 405
- `stattest` — p. 409
- `threshold_config` — p. 412
- `cma_migrate` — p. 423
- `cpmiquerybin` — p. 536
- `ppkg delete` — p. 541
- `mcd` — p. 754
- `mds_backup` — p. 757
- `mds_restore` — p. 760
- `mdscmd` — p. 761
- `mdsconfig` — p. 763
- `mdsenv` — p. 766
- `mdsquerydb` — p. 768
- `mdsstart` — p. 770
- `mdsstart_customer` — p. 774
- `mdsstat` — p. 775
- `mdsstop` — p. 777
- `mdsstop_customer` — p. 781
- `migrate_global_policies` — p. 796
- `comp_init_policy` — p. 962
- `connection_pipelining` — p. 966
- `connview` — p. 970
- `control_bootsec` — p. 977
- `cp_conf corexl` — p. 987
- `cp_conf fullha` — p. 990
- `cp_conf ha` — p. 991
- `cp_conf intfs` — p. 993
- `cp_conf sic` — p. 998
- `cpmonitor` — p. 1017
- `cppcap` — p. 1019
- `cpsdwan` — p. 1030
- `domains_tool` — p. 1043
- `dynamic_objects` — p. 1052
- `fw -i` — p. 1097
- `fw amw` — p. 1099
- `fw cgnat` — p. 1103
- `fw ctl` — p. 1105
- `fw ctl arp` — p. 1108
- `fw ctl bench` — p. 1109
- `fw ctl block` — p. 1111
- `fw ctl chain` — p. 1112
- `fw ctl conn` — p. 1114
- `fw ctl conntab` — p. 1116
- `fw ctl cpasstat` — p. 1128
- `fw ctl dlpkstat` — p. 1130
- `fw ctl get` — p. 1132
- `fw ctl iflist` — p. 1134
- `fw ctl install` — p. 1136
- `fw ctl leak` — p. 1137
- `fw ctl pstat` — p. 1141
- `fw ctl set` — p. 1144
- `fw ctl tcpstrstat` — p. 1148
- `fw ctl uninstall` — p. 1150
- `fw defaultgen` — p. 1151
- `fw fetch` — p. 1153
- `fw getifs` — p. 1160
- `fw isp_link` — p. 1162
- `fw lichosts` — p. 1165
- `fw monitor` — p. 1186
- `fw sdwan` — p. 1257
- `fw showuptables` — p. 1259
- `fw stat` — p. 1260
- `fw tab` — p. 1263
- `fw unloadlocal` — p. 1277
- `fw up_execute` — p. 1282
- `fw ver` — p. 1294
- `fwboot` — p. 1296
- `fwboot bootconf` — p. 1298
- `fwboot corexl` — p. 1302
- `fwboot cpuid` — p. 1309
- `fwboot default` — p. 1311
- `fwboot fwboot_ipv6` — p. 1312
- `fwboot fwdefault` — p. 1313
- `fwboot ha_conf` — p. 1314
- `fwboot ht` — p. 1315
- `fwboot multik_reg` — p. 1316
- `fwboot post_drv` — p. 1318
- `fwmode` — p. 1319
- `ioc_feeder` — p. 1321
- `ioc_feeds` — p. 1322
- `ioc_search` — p. 1323
- `tp_collector_cli` — p. 1331
- `usrchk` — p. 1335
- `cphastart` — p. 1428
- `cphastop` — p. 1429
- `fwaccel cfg` — p. 1456
- `fwaccel conns` — p. 1460
- `fwaccel dbg` — p. 1464
- `fwaccel dos` — p. 1478
- `fwaccel dos config` — p. 1482
- `fwaccel dos deny` — p. 1487
- `fwaccel dos drop_frags` — p. 1495
- `fwaccel dos drop_opts` — p. 1499
- `fwaccel dos ioc_deny` — p. 1503
- `fwaccel dos ioc_deny_ext` — p. 1505
- `fwaccel dos ioc_monitor` — p. 1507
- `fwaccel dos ioc_monitor_ext` — p. 1509
- `fwaccel dos pbox` — p. 1511
- `fwaccel dos rate` — p. 1519
- `fwaccel dos stats` — p. 1541
- `fwaccel feature` — p. 1544
- `fwaccel if` — p. 1547
- `fwaccel ip_mr_cache` — p. 1551
- `fwaccel nonaccel` — p. 1552
- `fwaccel off` — p. 1555
- `fwaccel on` — p. 1560
- `fwaccel ranges` — p. 1565
- `fwaccel stat` — p. 1572
- `fwaccel stats` — p. 1574
- `fwaccel synatk` — p. 1593
- `fwaccel synatk -a` — p. 1596
- `fwaccel synatk -c <Configuration File>` — p. 1597
- `fwaccel synatk -d` — p. 1598
- `fwaccel synatk -e` — p. 1599
- `fwaccel synatk -g` — p. 1600
- `fwaccel synatk -m` — p. 1601
- `fwaccel synatk -t <Threshold>` — p. 1602
- `fwaccel synatk allow` — p. 1604
- `fwaccel synatk config` — p. 1609
- `fwaccel synatk monitor` — p. 1612
- `fwaccel synatk state` — p. 1617
- `fwaccel tab` — p. 1619
- `fwaccel templates` — p. 1622
- `fwaccel ver` — p. 1627
- `dynamic_balancing` — p. 1714
- `fw ctl multik` — p. 1718
- `fw ctl multik add_bypass_port` — p. 1721
- `fw ctl multik del_bypass_port` — p. 1723
- `fw ctl multik dynamic_dispatching` — p. 1725
- `fw ctl multik gconn` — p. 1726
- `fw ctl multik get_instance` — p. 1731
- `fw ctl multik print_heavy_conn` — p. 1733
- `fw ctl multik prioq` — p. 1735
- `fw ctl multik queues` — p. 1736
- `fw ctl multik show_bypass_ports` — p. 1737
- `fw ctl multik snd_dist` — p. 1738
- `fw ctl multik stat` — p. 1741
- `fw ctl multik start` — p. 1743
- `fw ctl multik stop` — p. 1744
- `fw ctl multik utilize` — p. 1745
- `fw ctl affinity` — p. 1746
- `taskset_us_all` — p. 1781
- `mq_mng` — p. 1787
- `adlog` — p. 1797
- `adlog control` — p. 1799
- `adlog dc` — p. 1801
- `adlog debug` — p. 1802
- `adlog query` — p. 1803
- `adlog statistics` — p. 1804
- `adlogconfig` — p. 1805
- `pdp` — p. 1830
- `pdp ad` — p. 1833
- `pdp auth` — p. 1835
- `pdp broker` — p. 1839
- `pdp conciliation` — p. 1844
- `pdp connections` — p. 1846
- `pdp control` — p. 1847
- `pdp debug` — p. 1848
- `pdp idc` — p. 1851
- `pdp idp` — p. 1855
- `pdp monitor` — p. 1856
- `pdp muh` — p. 1859
- `pdp nested_groups` — p. 1860
- `pdp network` — p. 1863
- `pdp radius` — p. 1864
- `pdp roles` — p. 1867
- `pdp status` — p. 1870
- `pdp tasks_manager` — p. 1871
- `pdp timers` — p. 1872
- `pdp topology_map` — p. 1873
- `pdp tracker` — p. 1874
- `pdp update` — p. 1875
- `pdp vpn` — p. 1876
- `pep` — p. 1877
- `pep control` — p. 1878
- `pep debug` — p. 1881
- `pep show` — p. 1883
- `pep tracker` — p. 1886
- `test_ad_connectivity` — p. 1887
- `ike debug` — p. 1892
- `probemon` — p. 1904
- `vpn` — p. 1909
- `vpn check_ttm` — p. 1912
- `vpn compreset` — p. 1913
- `vpn compstat` — p. 1914
- `vpn crl_zap` — p. 1915
- `vpn crlview` — p. 1916
- `vpn debug` — p. 1918
- `vpn dll` — p. 1930
- `vpn drv` — p. 1931
- `vpn dump_psk` — p. 1932
- `vpn ipafile_check` — p. 1933
- `vpn ipafile_users_capacity` — p. 1934
- `vpn macutil` — p. 1935
- `vpn mep_refresh` — p. 1936
- `vpn neo_proto` — p. 1937
- `vpn nssm_toplogy` — p. 1938
- `vpn overlap_encdom` — p. 1939
- `vpn rim_cleanup` — p. 1941
- `vpn rll` — p. 1942
- `vpn set_slim_server` — p. 1943
- `vpn set_snx_encdom_groups` — p. 1944
- `vpn set_trac` — p. 1945
- `vpn shell` — p. 1946
- `vpn show_tcpt` — p. 1953
- `vpn tu` — p. 1954
- `vpn tu conn` — p. 1956
- `vpn tu del` — p. 1959
- `vpn tu list` — p. 1962
- `vpn tu mstats` — p. 1965
- `vpn tu tlist` — p. 1966
- `vpn ver` — p. 1977
- `mcc` — p. 1978
- `mcc add` — p. 1980
- `mcc add2main` — p. 1981
- `mcc del` — p. 1982
- `mcc lca` — p. 1983
- `mcc main2add` — p. 1984
- `mcc show` — p. 1985
- `admin_wizard` — p. 1988
- `cvpnd_admin` — p. 1992
- `cvpnd_settings` — p. 1995
- `cvpn_ver` — p. 1998
- `cvpnrestart` — p. 1999
- `cvpnstart` — p. 2000
- `cvpnstop` — p. 2001
- `deleteUserSettings` — p. 2002
- `fwpush` — p. 2003
- `ics_updates_script` — p. 2007
- `listusers` — p. 2008
- `rehash_ca_bundle` — p. 2009
- `dlpcmd` — p. 2013
- `vsenv` — p. 2021
- `vsx` — p. 2022
- `vsx fetch` — p. 2026
- `vsx fetch_all_cluster_policies` — p. 2028
- `vsx fetchvs` — p. 2029
- `vsx get` — p. 2030
- `vsx mstat` — p. 2031
- `vsx showncs` — p. 2035
- `vsx sicreset` — p. 2036
- `vsx stat` — p. 2037
- `vsx unloadall` — p. 2040
- `vsx vspurge` — p. 2041
- `vsx_util` — p. 2042
- `vsx_util add_member` — p. 2047
- `vsx_util change_interfaces` — p. 2049
- `vsx_util change_mgmt_ip` — p. 2053
- `vsx_util change_mgmt_subnet` — p. 2054
- `vsx_util change_private_net` — p. 2056
- `vsx_util convert_cluster` — p. 2058
- `vsx_util downgrade` — p. 2060
- `vsx_util reconfigure` — p. 2061
- `vsx_util remove_member` — p. 2067
- `vsx_util show_interfaces` — p. 2068
- `vsx_util upgrade` — p. 2072
- `vsx_util view_vs_conf` — p. 2073
- `vsx_util vsls` — p. 2077
- `vsx_provisioning_tool` — p. 2079
- `vsx_provisioning_tool Commands` — p. 2083
- `etmstart` — p. 2122
- `etmstop` — p. 2123
- `fgate` — p. 2124
- `ips` — p. 2133
- `ips bypass` — p. 2135
- `ips debug` — p. 2137
- `ips off` — p. 2138
- `ips on` — p. 2139
- `ips refreshcap` — p. 2140
- `ips stat` — p. 2141
- `ips stats` — p. 2142
- `rtm` — p. 2145
- `rtm debug` — p. 2146
- `rtm drv` — p. 2147
- `rtm rtmd` — p. 2148
- `rtm monitor` — p. 2149
- `rtm stat` — p. 2155
- `rtm ver` — p. 2158
- `rtmstart` — p. 2159
- `rtmstop` — p. 2160

## Progresso (continuação — pasta CheckPointDocs)

- **2026-07-21 — pasta CheckPointDocs conectada:** usuário pediu para ler todos os PDFs dessa pasta e extrair todos os comandos, incluindo duplicados. Inventário: 104 arquivos / ~45.600 páginas (94 depois de remover pares idênticos `.pdf`+`.cleaned.pdf`). Isso é ~20x maior que o CLI Reference Guide sozinho (que levou 14 lotes e ainda não terminou — task #108). Perguntei ao usuário como priorizar; resposta: **processar tudo, sem pular nada, sem priorização** — inclusive guias de Endpoint/CloudGuard/Installation/Release Notes/Best Practices/VoIP. Ver tabela completa na seção "Fonte 2" abaixo.
- **Lote CheckPointDocs #1 (2026-07-21):** processados os 2 Release Notes (R81.10 e R81.20, ~37-49 pág. cada) e o `CP_Check_Point_Gateway_and_Management_Hardening.cleaned.pdf` (38 pág.). Achados:
  - Hardening guide: zero sintaxe de comando (só recomendações em prosa) — marcado "sem conteúdo útil".
  - Release Notes: novo card `buildver` (tópico `system`) com `show version all` / `fw ver` / `fwm ver` / `fwm mds ver` — checagem de build exato por componente, útil antes de abrir chamado no TAC ou validar upgrade.
  - Release Notes: novo card `gaiaedition` (tópico `system`) com `set edition 64-bit` / `save config` / `reboot` — conversão de Gaia 32-bit→64-bit, pré-requisito de upgrade para R81.20+.
  - Release Notes R81.10 (p.31): 2 linhas novas incorporadas ao card `env-maestro` — `lspci -v | grep 'Ethernet controller' | grep Intel` e o loop `ethtool -i` por NIC — verificação de placa de rede/firmware em Maestro Security Appliances.
  - Banco: 73 → 75 comandos.
- **Lote CheckPointDocs #2 (2026-07-21):** `CP_R82_VoIP_AdminGuide.pdf` e `CP_R82_CloudGuard_Controller_AdminGuide.cleaned.pdf` — zero comandos de CLI (VoIP é regra de rulebase via SmartConsole; CloudGuard Controller só tem parâmetros de arquivo de configuração/propriedades, não comandos de shell). Marcados "sem conteúdo útil" para as 4 versões de cada (conteúdo estruturalmente igual entre versões nesses dois guias). `CP_R82_CarrierSecurity_AdminGuide.pdf` — achado real: comandos GTP (`fw gtp ho_groups` e variantes `fw ctl set int gtp_*`/`allow_sam_delete_gtp_tunnels`/`fwx_enable_sctp_nat`). Como isso é uma área técnica própria (Carrier/GTP), criado um tópico novo `carrier` (ícone 📶, cor #8B5CF6) em toda a UI (sidebar, Configurações, editor de comandos) e 2 cards novos: `gtpho` (fw gtp ho_groups, 5 linhas) e `gtptuning` (4 parâmetros de kernel GTP/SCTP, 8 linhas). Banco: 75 → 77 comandos. R81.10/R81.20/R82.10 do CarrierSecurity AdminGuide ainda pendentes (provavelmente conteúdo bem parecido, mas não conferido ainda).
- Próximos lotes desta fonte: seguir a tabela "Fonte 2" abaixo, um ou poucos documentos por vez (documentos maiores como CLI Reference Guides R81.10/R81.20 e os Admin Guides de 300-900 páginas vão precisar de vários lotes cada, igual ao já feito com o CLI Reference Guide R82 na Fonte 1).


## Fonte 2: pasta CheckPointDocs (conectada em 2026-07-21) - 104 arquivos, ~45.600 paginas

Pasta separada do projeto com o acervo completo de Admin Guides oficiais da Check Point (R81.10/R81.20/R82/R82.10) + 2 CLI Reference Guides (R81.10/R81.20, alem dos R82/R82.10 ja minerados na Fonte 1) + Release Notes + guias de Endpoint/Hardening. Usuario confirmou (2026-07-21): processar TUDO, sem pular nada, sem priorizacao - inclusive Endpoint/CloudGuard/Installation/Release Notes/Best Practices/VoIP.

Regra de deduplicacao: quando existe par "arquivo.pdf" + "arquivo.cleaned.pdf" com conteudo identico, processar so o .cleaned.pdf (texto ja normalizado) - nao e a duplicacao de versao que o usuario pediu para manter, e o mesmo arquivo extraido duas vezes.

Status: pendente | parcial | feito | sem conteudo util

| Documento (base) | Paginas | Status |
|---|---|---|
| CP_Check_Point_Endpoint_Security_Admin_Guide | 543 | pendente |
| CP_Check_Point_Gateway_and_Management_Hardening | 38 | sem conteudo util - so recomendacoes em prosa, zero sintaxe de comando |
| CP_R81.10_Best_Practices_for_Threat_Prevention | 68 | pendente |
| CP_R81.10_CLI_ReferenceGuide | 1697 | pendente |
| CP_R81.10_CarrierSecurity_AdminGuide | 90 | pendente (checar GTP, ver R82 já feito) |
| CP_R81.10_CloudGuard_Controller_AdminGuide | 54 | sem conteúdo útil (config de propriedades, sem CLI) |
| CP_R81.10_ClusterXL_AdminGuide | 306 | feito (2026-07-21) - conferido vs R82: só cphaprob latency e mais nada de novo (adicionado a clustermon) |
| CP_R81.10_DataLossPrevention_AdminGuide | 223 | pendente |
| CP_R81.10_Gaia_AdminGuide | 497 | pendente |
| CP_R81.10_Gaia_Advanced_Routing_AdminGuide | 481 | pendente |
| CP_R81.10_Harmony_Endpoint_Server_AdminGuide | 307 | pendente |
| CP_R81.10_Harmony_Endpoint_WebManagement_AdminGuide | 102 | pendente |
| CP_R81.10_IdentityAwareness_AdminGuide | 282 | pendente |
| CP_R81.10_Installation_and_Upgrade_Guide | 585 | pendente |
| CP_R81.10_LoggingAndMonitoring_AdminGuide | 234 | pendente |
| CP_R81.10_MobileAccess_AdminGuide | 288 | pendente |
| CP_R81.10_Multi-DomainSecurityManagement_AdminGuide | 510 | pendente |
| CP_R81.10_PerformanceTuning_AdminGuide | 506 | pendente |
| CP_R81.10_QoS_AdminGuide | 109 | pendente |
| CP_R81.10_Quantum_SecurityGateway_AdminGuide | 576 | pendente |
| CP_R81.10_Quantum_SecurityManagement_AdminGuide | 907 | pendente |
| CP_R81.10_ReleaseNotes | 37 | feito (2026-07-21) - buildver (fw ver/fwm ver/fwm mds ver), env-maestro (checagem de firmware de NIC) |
| CP_R81.10_RemoteAccessVPN_AdminGuide | 196 | pendente |
| CP_R81.10_SitetoSiteVPN_AdminGuide | 230 | pendente |
| CP_R81.10_SmartProvisioning_AdminGuide | 178 | pendente |
| CP_R81.10_ThreatPrevention_AdminGuide | 285 | pendente |
| CP_R81.10_VSX_AdminGuide | 338 | pendente |
| CP_R81.10_VoIP_AdminGuide | 73 | sem conteúdo útil (regras via SmartConsole, sem CLI) |
| CP_R81.20_Best_Practices_for_Threat_Prevention | 68 | pendente |
| CP_R81.20_CLI_ReferenceGuide | 1774 | pendente |
| CP_R81.20_CarrierSecurity_AdminGuide | 89 | pendente (checar GTP, ver R82 já feito) |
| CP_R81.20_CloudGuard_Controller_AdminGuide | 87 | sem conteúdo útil (config de propriedades, sem CLI) |
| CP_R81.20_ClusterXL_AdminGuide | 315 | feito (2026-07-21) - igual ao R81.10, nada além de cphaprob latency |
| CP_R81.20_DataLossPrevention_AdminGuide | 224 | pendente |
| CP_R81.20_Gaia_AdminGuide | 549 | pendente |
| CP_R81.20_Gaia_Advanced_Routing_AdminGuide | 576 | pendente |
| CP_R81.20_Harmony_Endpoint_Server_AdminGuide | 386 | pendente |
| CP_R81.20_Harmony_Endpoint_WebManagement_AdminGuide | 203 | pendente |
| CP_R81.20_IdentityAwareness_AdminGuide | 308 | pendente |
| CP_R81.20_Installation_and_Upgrade_Guide | 635 | pendente |
| CP_R81.20_LoggingAndMonitoring_AdminGuide | 265 | pendente |
| CP_R81.20_MobileAccess_AdminGuide | 287 | pendente |
| CP_R81.20_MultiDomainSecurityManagement_AdminGuide | 533 | pendente |
| CP_R81.20_PerformanceTuning_AdminGuide | 542 | pendente |
| CP_R81.20_QoS_AdminGuide | 112 | pendente |
| CP_R81.20_Quantum_Maestro_AdminGuide | 541 | feito (Lote 11) |
| CP_R81.20_Quantum_SecurityGateway_AdminGuide | 599 | pendente |
| CP_R81.20_Quantum_SecurityManagement_AdminGuide | 946 | pendente |
| CP_R81.20_ReleaseNotes | 49 | feito (2026-07-21) - gaiaedition (set edition 64-bit), confirmado fw ver/fwm ver |
| CP_R81.20_RemoteAccessVPN_AdminGuide | 214 | pendente |
| CP_R81.20_SitetoSiteVPN_AdminGuide | 242 | pendente |
| CP_R81.20_SmartProvisioning_AdminGuide | 180 | pendente |
| CP_R81.20_ThreatPrevention_AdminGuide | 340 | pendente |
| CP_R81.20_VSX_AdminGuide | 340 | pendente |
| CP_R81.20_VoIP_AdminGuide | 74 | sem conteúdo útil (regras via SmartConsole, sem CLI) |
| CP_R82.10_CLI_ReferenceGuide | 2182 | pendente |
| CP_R82.10_CarrierSecurity_AdminGuide | 102 | pendente (checar GTP, ver R82 já feito) |
| CP_R82.10_ClusterXL_AdminGuide | 381 | feito (2026-07-21) - novidades: cphaconf force_failover, cphaconf vs_monitor (VSX VSLS) adicionados a clusterconf |
| CP_R82.10_DataLossPrevention_AdminGuide | 336 | pendente |
| CP_R82.10_IdentityAwareness_AdminGuide | 375 | pendente |
| CP_R82.10_LoggingAndMonitoring_AdminGuide | 263 | pendente |
| CP_R82.10_MobileAccess_AdminGuide | 341 | pendente |
| CP_R82.10_QoS_AdminGuide | 114 | pendente |
| CP_R82.10_Quantum_SecurityGateway_AdminGuide | 404 | pendente |
| CP_R82.10_RemoteAccessVPN_AdminGuide | 242 | pendente |
| CP_R82.10_SitetoSiteVPN_AdminGuide | 319 | pendente |
| CP_R82.10_SmartProvisioning_AdminGuide | 223 | pendente |
| CP_R82.10_VSX_AdminGuide | 447 | pendente |
| CP_R82.10_VoIP_AdminGuide | 83 | sem conteúdo útil (regras via SmartConsole, sem CLI) |
| CP_R82_CLI_ReferenceGuide | 2204 | parcial - 14 lotes ja rodados (Fonte 1), ~385 entradas do sumario ainda faltam |
| CP_R82_CarrierSecurity_AdminGuide | 103 | feito (2026-07-21) - gtpho + gtptuning, novo tópico carrier |
| CP_R82_Check_Point_Endpoint_Security_Server_AdminGuide | 488 | pendente |
| CP_R82_CloudGuard_Controller_AdminGuide | 122 | sem conteúdo útil (2026-07-21) - só parâmetros de config, sem CLI |
| CP_R82_ClusterXL_AdminGuide | 365 | feito (2026-07-21) - cphaprob/show cluster (clustermon), cphaconf/set cluster member (clusterconf), cphastart/cphastop/fwboot ha_conf (env-cluster), cp_conf fullha/ha (cpconf) |
| CP_R82_DataLossPrevention_AdminGuide | 351 | pendente |
| CP_R82_Gaia_AdminGuide | 836 | pendente |
| CP_R82_Gaia_Advanced_Routing_AdminGuide | 681 | pendente |
| CP_R82_IdentityAwareness_AdminGuide | 356 | pendente |
| CP_R82_Installation_and_Upgrade_Guide | 741 | pendente |
| CP_R82_LoggingAndMonitoring_AdminGuide | 315 | pendente |
| CP_R82_MobileAccess_AdminGuide | 340 | pendente |
| CP_R82_MultiDomainSecurityManagement_AdminGuide | 641 | pendente |
| CP_R82_PerformanceTuning_AdminGuide | 495 | pendente |
| CP_R82_QoS_AdminGuide | 125 | pendente |
| CP_R82_Quantum_SecurityGateway_AdminGuide | 394 | pendente |
| CP_R82_Quantum_SecurityManagement_AdminGuide | 934 | pendente |
| CP_R82_RemoteAccessVPN_AdminGuide | 234 | pendente |
| CP_R82_ScalablePlatforms_AdminGuide | 1054 | pendente |
| CP_R82_SitetoSiteVPN_AdminGuide | 328 | pendente |
| CP_R82_SmartProvisioning_AdminGuide | 221 | pendente |
| CP_R82_ThreatPrevention_AdminGuide | 534 | pendente |
| CP_R82_VSX_AdminGuide | 442 | pendente |
| CP_R82_VoIP_AdminGuide | 83 | sem conteúdo útil (2026-07-21) - regras via SmartConsole, sem CLI |
| R81.20_Maestro_CLI_Cheat_v07 | 4 | feito (Lote 9) |