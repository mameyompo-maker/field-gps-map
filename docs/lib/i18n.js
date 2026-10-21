/* field_gps_map — 表示の言語(ポルトガル語 / 日本語)。
 * 現場のスタッフはポルトガル語、Kazさん・上司は日本語。端末の言語が日本語なら ja、
 * それ以外は pt で始まり、メニューからいつでも切り替えられる。
 * モザンビークの表記(欧州ポルトガル語寄り: registo, ecrã, telemóvel)に合わせる。
 */
const DICT = {
  pt: {
    'common.back': 'Voltar', 'common.cancel': 'Cancelar', 'common.close': 'Fechar', 'common.ok': 'OK', 'common.save': 'Guardar',

    'login.lead': 'Registe pontos, áreas e percursos com o GPS do telemóvel — mesmo sem rede — e partilhe com a equipa.',
    'login.p1': 'Funciona sem rede: os registos ficam no telemóvel e são enviados sozinhos quando houver rede.',
    'login.p2': 'Área em hectares calculada na hora (a andar à volta do campo ou marcando os cantos).',
    'login.p3': 'Mapa do Google com imagem de satélite; exporta KML para Google Earth / My Maps, CSV para Excel.',
    'login.google': 'Entrar com Google',
    'login.demo': 'Experimentar sem conta (só neste telemóvel)',
    'login.loading': 'A carregar…',
    'login.checking': 'A verificar o acesso…',
    'login.opening': 'A abrir a janela do Google…',
    'login.failed': 'Não foi possível entrar ({msg}).',
    'login.error': 'Não foi possível verificar o acesso. Verifique a rede e tente de novo. ({msg})',
    'denied.title': 'Sem acesso',
    'denied.text': 'A conta {email} ainda não tem acesso.',
    'denied.how': 'Peça ao responsável (Kaz) para adicionar o seu e-mail à lista. Depois carregue em “Verificar de novo”.',
    'denied.recheck': 'Verificar de novo',
    'boot.title': 'Não foi possível abrir',
    'boot.offline': 'Sem rede e a app ainda não foi aberta neste telemóvel com rede. Abra uma vez com rede; depois funciona sem rede.',
    'boot.failed': 'Falha ao carregar a app. Tente de novo.',
    'boot.retry': 'Tentar de novo',
    'demo.user': 'Modo de teste',
    'demo.note': 'Modo de teste — os dados ficam só neste telemóvel',

    'menu.open': 'Menu', 'menu.list': 'Lista de registos', 'menu.export': 'Exportar (KML / CSV / GeoJSON)',
    'menu.import': 'Importar KML / GeoJSON', 'menu.settings': 'Definições', 'menu.help': 'Como usar',
    'menu.lang': '日本語に切り替え', 'menu.sync': 'Sincronizar agora', 'menu.signout': 'Sair',
    'menu.leaveDemo': 'Sair do modo de teste', 'menu.signout.rec': 'Há uma gravação em curso. Sair mesmo assim? (o rascunho fica guardado neste telemóvel)',

    'map.layers': 'Tipo de mapa', 'map.locate': 'A minha posição',
    'map.layersNote': 'Sem rede, a imagem de satélite não aparece (o Google não permite guardá-la). Use o mapa simples: mostra a sua posição e os registos sobre uma grelha com escala.',
    'map.simpleTag': 'Mapa simples (sem imagem) — funciona sem rede',
    'map.offlineBanner': 'Sem rede: a imagem de satélite pode não carregar. Pode continuar a gravar.',
    'map.onlineBanner': 'A rede voltou.',
    'map.useSimple': 'Usar mapa simples', 'map.useGoogle': 'Mostrar satélite',
    'map.tilesFail': 'O mapa do Google não carregou.',
    'map.googleFail': 'O mapa do Google não está disponível agora (sem rede?). A usar o mapa simples.',

    'gps.wait': 'GPS…', 'gps.off': 'GPS desligado',
    'gps.waiting': 'À espera do sinal GPS. Fique num lugar aberto (sem árvores por cima) durante 1–2 minutos.',
    'gps.denied': 'A localização está bloqueada. Ative a localização do telemóvel e permita-a para este site (cadeado ao lado do endereço → Permissões → Localização).',
    'gps.unavailable': 'O GPS não está disponível neste aparelho/navegador.',
    'gps.detail': 'Precisão ±{acc} m (há {age} s). {lat}, {lng}. Quanto menor o número, melhor: espere até ficar abaixo de 5–10 m.',

    'new.button': 'Novo registo', 'new.title': 'O que quer registar?', 'new.how': '{kind}: como registar?',
    'new.recommended': 'recomendado',
    'kind.polygon': 'Área', 'kind.polygon.d': 'Campo, viveiro, bloco (calcula ha)',
    'kind.line': 'Linha', 'kind.line.d': 'Rio, caminho, sebe (mede o comprimento)',
    'kind.point': 'Ponto', 'kind.point.d': 'Planta, poço, armazém',
    'method.walk': 'Andar à volta', 'method.corners': 'Marcar os cantos', 'method.tap': 'Tocar no mapa',
    'method.gps': 'Posição GPS (média)', 'method.import': 'Importado',
    'method.walk.d.polygon': 'Carregue em Começar e ande pela borda do campo. Os pontos são marcados sozinhos. Melhor para campos com forma irregular.',
    'method.walk.d.line': 'Carregue em Começar e ande ao longo do rio/caminho. Os pontos são marcados sozinhos.',
    'method.corners.d.polygon': 'Pare em cada canto e carregue no botão. Faz a média de alguns segundos de GPS (mais preciso). Melhor para campos retangulares.',
    'method.corners.d.line': 'Pare em cada curva e carregue no botão (média de alguns segundos de GPS).',
    'method.tap.d.polygon': 'Toque no mapa de satélite em cada canto. Para lugares onde não se pode ir. Não é medição GPS.',
    'method.tap.d.line': 'Toque no mapa em cada ponto da linha. Não é medição GPS.',
    'method.gps.d.point': 'Fique parado no lugar. Faz a média de alguns segundos de GPS.',
    'method.tap.d.point': 'Toque no mapa no lugar do ponto. Não é medição GPS.',

    'rec.vertices': 'Pontos', 'rec.area': 'Área', 'rec.perimeter': 'Perímetro', 'rec.length': 'Comprimento',
    'rec.accuracy': 'GPS', 'rec.coords': 'Coordenadas',
    'rec.undo': 'Desfazer', 'rec.finish': 'Terminar', 'rec.savePoint': 'Guardar ponto', 'rec.cancel': 'Cancelar gravação',
    'rec.cancel.yes': 'Sim, apagar', 'rec.confirmCancel': 'Apagar esta gravação? Os pontos marcados serão perdidos.',
    'rec.pause': 'Pausa', 'rec.continue': 'Continuar', 'rec.begin': 'Começar',
    'rec.mark': 'Marcar este canto (n.º {n})', 'rec.remeasure': 'Medir de novo', 'rec.stopNow': 'Parar já (usar o que tem)',
    'rec.collecting': 'A medir… faltam {s} s · leituras: {n}',
    'rec.hint.walk': 'A gravar — ande pela borda. Mantenha o ecrã ligado.',
    'rec.hint.walkPaused': 'Em pausa. Vá ao ponto de partida e carregue em Começar/Continuar.',
    'rec.hint.corners.polygon': 'Vá ao canto, fique parado e carregue no botão verde.',
    'rec.hint.corners.line': 'Vá a cada curva, fique parado e carregue no botão verde.',
    'rec.hint.tap.polygon': 'Toque no mapa em cada canto, por ordem à volta do campo.',
    'rec.hint.tap.line': 'Toque no mapa em cada ponto, por ordem.',
    'rec.hint.gps.point': 'Fique parado. A posição é a média de alguns segundos.',
    'rec.hint.tap.point': 'Toque no mapa no lugar do ponto (pode tocar de novo para mudar).',
    'rec.warn.rejected': 'Leituras ignoradas (precisão pior que ±{max} m): {n}.',
    'rec.warn.gap': 'O GPS parou durante algum tempo (ecrã desligado ou outra app): pode haver um salto no traçado.',
    'rec.warn.cross': 'As linhas da área cruzam-se (forma de “8”): a área pode estar errada.',
    'rec.warn.close': 'Ainda está a {m} m do ponto de partida. Volte ao início antes de terminar.',
    'rec.wasHidden': 'Atenção: com o ecrã desligado ou noutra app o GPS para. Mantenha esta app aberta enquanto anda.',
    'rec.lowAcc': 'Precisão fraca (±{acc} m, limite ±{max} m). Foi usada a melhor leitura. Se puder, espere e meça de novo.',
    'rec.noFix': 'Nenhuma leitura de GPS recebida. Vá para um lugar aberto e tente de novo.',
    'rec.err.none': 'Nada a guardar.', 'rec.err.poly': 'Uma área precisa de pelo menos 3 pontos.',
    'rec.err.line': 'Uma linha precisa de pelo menos 2 pontos.', 'rec.err.point': 'Ainda não há ponto.',
    'rec.resume': 'Há uma gravação não terminada (pontos: {n}). Continuar?',
    'rec.resume.yes': 'Continuar', 'rec.resume.no': 'Apagar',

    'save.title': 'Guardar registo', 'save.editTitle': 'Editar dados',
    'save.name': 'Nome *', 'save.category': 'Tipo', 'save.group': 'Grupo / Localidade',
    'save.group.ph': 'ex.: Malema 2, Netia-Sede', 'save.notes': 'Notas', 'save.ok': 'Guardar',
    'save.warn.tap': '{n} ponto(s) foram tocados no mapa (não medidos com GPS).',
    'save.ok.online': 'Guardado e enviado.', 'save.ok.offline': 'Guardado no telemóvel. Será enviado sozinho quando houver rede.',
    'save.ok.demo': 'Guardado neste telemóvel (modo de teste).', 'save.updated': 'Alterações guardadas.',

    'cat.field': 'Campo / machamba', 'cat.block': 'Bloco do campo', 'cat.nursery': 'Viveiro', 'cat.hedge': 'Sebe viva / vedação',
    'cat.water': 'Rio / água', 'cat.road': 'Caminho / estrada', 'cat.building': 'Edifício / armazém', 'cat.tree': 'Planta / árvore', 'cat.other': 'Outro',

    'list.title': 'Registos', 'list.search': 'Procurar nome, grupo, notas…', 'list.all': 'Todos', 'list.areas': 'Áreas',
    'list.lines': 'Linhas', 'list.points': 'Pontos', 'list.mine': 'Só os meus', 'list.allGroups': 'Todos os grupos',
    'list.sort.new': 'Mais recentes', 'list.sort.name': 'Nome', 'list.sort.area': 'Maior primeiro',
    'list.summary': 'Registos: {n} · Áreas: {a} · Total: {ha} ha', 'list.empty': 'Ainda não há registos. Carregue em “Novo registo”.',
    'list.noMatch': 'Nenhum registo com este filtro.',

    'd.zoom': 'Ver no mapa', 'd.gmaps': 'Abrir no Google Maps', 'd.share': 'Partilhar texto', 'd.kml': 'Enviar KML',
    'd.edit': 'Editar', 'd.archive': 'Arquivar', 'd.archive.confirm': 'Arquivar “{name}”? Deixa de aparecer na lista (não é apagado da base de dados).',
    'd.archived': 'Arquivado.', 'd.by': 'Registado por', 'd.date': 'Data', 'd.method': 'Método', 'd.accuracy': 'Precisão GPS',
    'd.accText': 'mediana ±{med} m · pior ±{max} m', 'd.tapped': 'Pontos tocados no mapa', 'd.editedBy': 'Editado por',
    'd.sync': 'Envio', 'd.sync.pending': 'À espera de rede (guardado no telemóvel)', 'd.sync.ok': 'Enviado',
    'd.sync.demo': 'Só neste telemóvel (modo de teste)', 'd.noName': '(sem nome)', 'd.appLink': 'Abrir na app',
    'd.copied': 'Texto copiado. Cole no WhatsApp.', 'd.copyPrompt': 'Copie o texto:',

    'exp.title': 'Exportar', 'exp.scope': 'O quê', 'exp.scope.all': 'Todos os registos', 'exp.scope.filtered': 'Só os do filtro da lista',
    'exp.scope.mine': 'Só os meus', 'exp.count': 'Registos: {n}',
    'exp.kml': 'Google Earth, Google My Maps (com as áreas)', 'exp.geojson': 'QGIS e outros programas de mapas',
    'exp.csv': 'Excel (uma linha por registo, com área em ha)', 'exp.zip': 'Os três ficheiros juntos',
    'exp.none': 'Não há registos para exportar.', 'exp.done': 'Exportado: {n} registo(s).',
    'exp.readme': 'Field GPS Map — exportação\r\n\r\nfield_gps_map.kml     Google Earth (Web: Projetos > Importar KML) ou Google My Maps (Importar).\r\nfield_gps_map.geojson QGIS: arrastar o ficheiro para o mapa. Coordenadas WGS84 (EPSG:4326).\r\nfield_gps_map.csv     Excel. area_ha = hectares; wkt = forma (QGIS: Texto delimitado > WKT).\r\n',

    'imp.title': 'Importar', 'imp.lead': 'KML/KMZ (ex.: exportado do GPS Fields Area Measure ou Google Earth) ou GeoJSON. Cada área/linha/ponto vira um registo partilhado.',
    'imp.found': 'Encontrado — áreas: {p}, linhas: {l}, pontos: {pt}.', 'imp.error': 'Não foi possível ler o ficheiro.',
    'imp.ok': 'Importar', 'imp.unnamed': 'Importado {n}', 'imp.done': 'Importado: {n} registo(s).',

    'set.title': 'Definições', 'set.lang': 'Língua',
    'set.maxAcc': 'Precisão mínima aceite (m)', 'set.maxAcc.d': 'Leituras piores que isto não são usadas. 10 m é um bom valor para telemóveis.',
    'set.minDist': 'Distância entre pontos ao andar (m)', 'set.minDist.d': 'Ao andar à volta, marca um ponto a cada X metros.',
    'set.avg': 'Segundos de média (cantos e pontos)', 'set.avg.d': 'Mais segundos = mais preciso, mas mais lento.',
    'set.mapMode': 'Mapa', 'set.mapMode.auto': 'Automático (Google com rede, simples sem rede)',
    'set.mapMode.google': 'Sempre Google', 'set.mapMode.simple': 'Mapa simples (sem imagem)',
    'set.mapType': 'Imagem do Google', 'set.mapType.hybrid': 'Satélite com nomes', 'set.mapType.satellite': 'Satélite',
    'set.mapType.roadmap': 'Mapa', 'set.mapType.terrain': 'Relevo', 'set.saved': 'Definições guardadas.',

    'sync.demo': 'Teste', 'sync.ok': 'Enviado', 'sync.cache': 'Guardado', 'sync.offline': 'Sem rede',
    'sync.offlineN': 'Sem rede · {n} por enviar', 'sync.pending': '{n} por enviar', 'sync.badge': 'por enviar',
    'sync.demoHelp': 'Modo de teste: os dados ficam só neste telemóvel e não são partilhados.',
    'sync.offlineHelp': 'Sem rede. {n} registo(s) guardados no telemóvel serão enviados sozinhos quando houver rede (com a app aberta).',
    'sync.trying': 'A enviar…', 'sync.done': 'Tudo enviado.', 'sync.wait': 'Ainda a enviar. Mantenha a app aberta com rede.',
    'err.write': 'Erro ao guardar no servidor: {msg}'
  },

  ja: {
    'common.back': '戻る', 'common.cancel': 'キャンセル', 'common.close': '閉じる', 'common.ok': 'OK', 'common.save': '保存',

    'login.lead': 'スマホのGPSで地点・区画(面積)・線を記録し、チームで共有するアプリです。電波が無くても記録できます。',
    'login.p1': '圏外でも記録できます。記録は端末に保存され、電波が戻ると自動で送信されます。',
    'login.p2': '外周を歩く・角を記録する、のどちらでも面積(ha)がその場で出ます。',
    'login.p3': 'Google マップの衛星写真の上に表示。KML(Google Earth/マイマップ)・CSV(Excel)で書き出せます。',
    'login.google': 'Googleでログイン',
    'login.demo': 'アカウントなしで試す(この端末だけ)',
    'login.loading': '読み込み中…',
    'login.checking': 'アクセス権を確認しています…',
    'login.opening': 'Googleのログイン画面を開いています…',
    'login.failed': 'ログインできませんでした({msg})。',
    'login.error': 'アクセス権を確認できませんでした。電波を確かめてもう一度お試しください。({msg})',
    'denied.title': 'アクセス権がありません',
    'denied.text': '{email} はまだ登録されていません。',
    'denied.how': '管理者(Kazさん)にメールアドレスを許可リストへ追加してもらい、「もう一度確認」を押してください。',
    'denied.recheck': 'もう一度確認',
    'boot.title': '開けませんでした',
    'boot.offline': '電波が無く、この端末ではまだ一度も電波のある所でアプリを開いていません。一度電波のある所で開けば、その後は圏外でも動きます。',
    'boot.failed': 'アプリの読み込みに失敗しました。もう一度お試しください。',
    'boot.retry': 'もう一度',
    'demo.user': '試用モード',
    'demo.note': '試用モード — データはこの端末にだけ保存されます',

    'menu.open': 'メニュー', 'menu.list': '記録の一覧', 'menu.export': '書き出し(KML / CSV / GeoJSON)',
    'menu.import': 'KML / GeoJSON の読み込み', 'menu.settings': '設定', 'menu.help': '使い方',
    'menu.lang': 'Mudar para português', 'menu.sync': '今すぐ同期', 'menu.signout': 'ログアウト',
    'menu.leaveDemo': '試用モードを終える', 'menu.signout.rec': '記録の途中です。ログアウトしますか?(下書きはこの端末に残ります)',

    'map.layers': '地図の種類', 'map.locate': '現在地',
    'map.layersNote': '圏外では衛星写真は出ません(Google の規約で保存できないため)。簡易地図なら、方眼と縮尺の上に現在地と記録を表示します。',
    'map.simpleTag': '簡易地図(写真なし)— 圏外でも動きます',
    'map.offlineBanner': '圏外です。衛星写真が出ないことがありますが、記録は続けられます。',
    'map.onlineBanner': '電波が戻りました。',
    'map.useSimple': '簡易地図にする', 'map.useGoogle': '衛星写真を表示',
    'map.tilesFail': 'Google マップを読み込めませんでした。',
    'map.googleFail': 'いま Google マップを使えません(圏外?)。簡易地図で表示します。',

    'gps.wait': 'GPS…', 'gps.off': 'GPSオフ',
    'gps.waiting': 'GPSの電波を待っています。上空の開けた場所(木の下でない所)で1〜2分待ってください。',
    'gps.denied': '位置情報がブロックされています。スマホの位置情報をオンにし、このサイトに許可してください(アドレス横の鍵マーク → 権限 → 位置情報)。',
    'gps.unavailable': 'この端末・ブラウザではGPSを使えません。',
    'gps.detail': '誤差 ±{acc} m({age} 秒前)。{lat}, {lng}。数字が小さいほど正確です。5〜10 m 以下になるまで待ってください。',

    'new.button': '新しく記録', 'new.title': '何を記録しますか?', 'new.how': '{kind}:記録のしかた',
    'new.recommended': 'おすすめ',
    'kind.polygon': '区画(面)', 'kind.polygon.d': '圃場・苗畑・ブロック(面積ha)',
    'kind.line': '線', 'kind.line.d': '川・道・生垣(長さ)',
    'kind.point': '地点', 'kind.point.d': '株・井戸・倉庫',
    'method.walk': '外周を歩く', 'method.corners': '角を記録', 'method.tap': '地図をタップ',
    'method.gps': 'GPSで測位(平均)', 'method.import': '読み込み',
    'method.walk.d.polygon': '「開始」を押して圃場の縁を歩くと、自動で点が打たれます。形が不規則な圃場向き。',
    'method.walk.d.line': '「開始」を押して川・道に沿って歩くと、自動で点が打たれます。',
    'method.corners.d.polygon': '角ごとに立ち止まってボタンを押します。数秒分のGPSを平均するので正確。長方形の圃場向き。',
    'method.corners.d.line': '曲がり角ごとに立ち止まってボタンを押します(数秒分のGPSを平均)。',
    'method.tap.d.polygon': '衛星写真の上で角をタップします。立ち入れない場所用。GPSの実測ではありません。',
    'method.tap.d.line': '地図上で線の点をタップします。GPSの実測ではありません。',
    'method.gps.d.point': 'その場に立ち止まります。数秒分のGPSを平均します。',
    'method.tap.d.point': '地図上でその場所をタップします。GPSの実測ではありません。',

    'rec.vertices': '点の数', 'rec.area': '面積', 'rec.perimeter': '外周', 'rec.length': '長さ',
    'rec.accuracy': 'GPS', 'rec.coords': '座標',
    'rec.undo': '1つ戻す', 'rec.finish': '終了', 'rec.savePoint': 'この地点を保存', 'rec.cancel': '記録をやめる',
    'rec.cancel.yes': 'はい、消す', 'rec.confirmCancel': 'この記録を消しますか?打った点は失われます。',
    'rec.pause': '一時停止', 'rec.continue': '再開', 'rec.begin': '開始',
    'rec.mark': 'この角を記録({n}つ目)', 'rec.remeasure': '測り直す', 'rec.stopNow': 'ここで打ち切る(集まった分で決める)',
    'rec.collecting': '測位中… 残り {s} 秒 · {n} 回',
    'rec.hint.walk': '記録中 — 縁を歩いてください。画面は点けたままに。',
    'rec.hint.walkPaused': '一時停止中。出発点に立って「開始/再開」を押してください。',
    'rec.hint.corners.polygon': '角まで行って立ち止まり、緑のボタンを押してください。',
    'rec.hint.corners.line': '曲がり角ごとに立ち止まり、緑のボタンを押してください。',
    'rec.hint.tap.polygon': '圃場を一周する順に、地図上の角をタップしてください。',
    'rec.hint.tap.line': '順番に、地図上の点をタップしてください。',
    'rec.hint.gps.point': '立ち止まってください。数秒分の測位を平均します。',
    'rec.hint.tap.point': '地図上でその場所をタップ(もう一度タップすると置き直し)。',
    'rec.warn.rejected': '誤差が ±{max} m より大きい測位を {n} 回使わずに捨てました。',
    'rec.warn.gap': 'GPSが一時止まっていました(画面が消えた・別アプリに切り替えた)。軌跡が飛んでいる可能性があります。',
    'rec.warn.cross': '区画の線が交差しています(8の字)。面積が正しくない可能性があります。',
    'rec.warn.close': '出発点からまだ {m} m 離れています。出発点まで戻ってから終了してください。',
    'rec.wasHidden': '注意:画面が消えたり別のアプリに切り替えたりするとGPSが止まります。歩いている間はこのアプリを開いたままにしてください。',
    'rec.lowAcc': '精度が悪い状態です(±{acc} m、基準 ±{max} m)。いちばん良い測位を使いました。できれば待って測り直してください。',
    'rec.noFix': 'GPSの測位が1回も届きませんでした。開けた場所に移ってもう一度お試しください。',
    'rec.err.none': '保存するものがありません。', 'rec.err.poly': '区画には点が3つ以上必要です。',
    'rec.err.line': '線には点が2つ以上必要です。', 'rec.err.point': 'まだ地点がありません。',
    'rec.resume': '終わっていない記録(点 {n} 個)があります。続けますか?',
    'rec.resume.yes': '続ける', 'rec.resume.no': '消す',

    'save.title': '記録を保存', 'save.editTitle': '情報を編集',
    'save.name': '名前 *', 'save.category': '種類', 'save.group': 'グループ / 地域',
    'save.group.ph': '例:Malema 2、Netia-Sede', 'save.notes': 'メモ', 'save.ok': '保存',
    'save.warn.tap': '{n} 個の点は地図のタップで置いたものです(GPSの実測ではありません)。',
    'save.ok.online': '保存して送信しました。', 'save.ok.offline': '端末に保存しました。電波が戻ると自動で送信されます。',
    'save.ok.demo': 'この端末に保存しました(試用モード)。', 'save.updated': '変更を保存しました。',

    'cat.field': '圃場・畑', 'cat.block': '圃場の区画(ブロック)', 'cat.nursery': '苗畑', 'cat.hedge': '生垣・フェンス',
    'cat.water': '川・水源', 'cat.road': '道', 'cat.building': '建物・倉庫', 'cat.tree': '株・木', 'cat.other': 'その他',

    'list.title': '記録', 'list.search': '名前・グループ・メモで検索…', 'list.all': 'すべて', 'list.areas': '区画',
    'list.lines': '線', 'list.points': '地点', 'list.mine': '自分の記録だけ', 'list.allGroups': '全グループ',
    'list.sort.new': '新しい順', 'list.sort.name': '名前順', 'list.sort.area': '大きい順',
    'list.summary': '{n} 件 · 区画 {a} 件 · 合計 {ha} ha', 'list.empty': 'まだ記録がありません。「新しく記録」を押してください。',
    'list.noMatch': 'この条件に合う記録はありません。',

    'd.zoom': '地図で見る', 'd.gmaps': 'Google マップで開く', 'd.share': '文章で共有', 'd.kml': 'KMLを送る',
    'd.edit': '編集', 'd.archive': 'アーカイブ', 'd.archive.confirm': '「{name}」をアーカイブしますか?一覧から消えます(データベースからは消えません)。',
    'd.archived': 'アーカイブしました。', 'd.by': '記録者', 'd.date': '日時', 'd.method': '方法', 'd.accuracy': 'GPSの精度',
    'd.accText': '中央値 ±{med} m · 最大 ±{max} m', 'd.tapped': '地図タップの点', 'd.editedBy': '最終編集',
    'd.sync': '送信', 'd.sync.pending': '電波待ち(端末に保存済み)', 'd.sync.ok': '送信済み',
    'd.sync.demo': 'この端末だけ(試用モード)', 'd.noName': '(名前なし)', 'd.appLink': 'アプリで開く',
    'd.copied': '文章をコピーしました。WhatsApp などに貼り付けてください。', 'd.copyPrompt': '次の文章をコピーしてください:',

    'exp.title': '書き出し', 'exp.scope': '対象', 'exp.scope.all': 'すべての記録', 'exp.scope.filtered': '一覧の絞り込み結果だけ',
    'exp.scope.mine': '自分の記録だけ', 'exp.count': '{n} 件',
    'exp.kml': 'Google Earth・Google マイマップ用(区画の形も入ります)', 'exp.geojson': 'QGIS などの地図ソフト用',
    'exp.csv': 'Excel 用(1行1件、面積 ha つき)', 'exp.zip': '上の3つをまとめて',
    'exp.none': '書き出す記録がありません。', 'exp.done': '{n} 件を書き出しました。',
    'exp.readme': 'Field GPS Map 書き出し\r\n\r\nfield_gps_map.kml     Google Earth(Web版:プロジェクト > KMLファイルをインポート)、Google マイマップ(インポート)。\r\nfield_gps_map.geojson QGIS:ファイルを地図にドラッグ。座標は WGS84(EPSG:4326)。\r\nfield_gps_map.csv     Excel。area_ha = ヘクタール、wkt = 形(QGIS:区切りテキスト > WKT)。\r\n',

    'imp.title': '読み込み', 'imp.lead': 'KML/KMZ(GPS Fields Area Measure や Google Earth から書き出したもの)か GeoJSON。区画・線・地点が1件ずつ共有の記録になります。',
    'imp.found': '区画 {p} 件、線 {l} 件、地点 {pt} 件が見つかりました。', 'imp.error': 'ファイルを読めませんでした。',
    'imp.ok': '読み込む', 'imp.unnamed': '読み込み {n}', 'imp.done': '{n} 件を読み込みました。',

    'set.title': '設定', 'set.lang': '言語',
    'set.maxAcc': '使う測位の誤差の上限(m)', 'set.maxAcc.d': 'これより誤差の大きい測位は使いません。スマホなら 10 m が目安です。',
    'set.minDist': '歩いて記録するときの点の間隔(m)', 'set.minDist.d': '外周を歩くとき、何 m ごとに点を打つか。',
    'set.avg': '平均する秒数(角・地点)', 'set.avg.d': '長いほど正確ですが、時間がかかります。',
    'set.mapMode': '地図', 'set.mapMode.auto': '自動(電波あり=Google、圏外=簡易地図)',
    'set.mapMode.google': '常に Google', 'set.mapMode.simple': '簡易地図(写真なし)',
    'set.mapType': 'Google の表示', 'set.mapType.hybrid': '航空写真+地名', 'set.mapType.satellite': '航空写真',
    'set.mapType.roadmap': '地図', 'set.mapType.terrain': '地形', 'set.saved': '設定を保存しました。',

    'sync.demo': '試用', 'sync.ok': '送信済み', 'sync.cache': '保存済み', 'sync.offline': '圏外',
    'sync.offlineN': '圏外 · 未送信 {n} 件', 'sync.pending': '未送信 {n} 件', 'sync.badge': '未送信',
    'sync.demoHelp': '試用モードです。データはこの端末にだけあり、共有されません。',
    'sync.offlineHelp': '圏外です。端末に保存された {n} 件は、電波が戻ると(アプリを開いている間に)自動で送信されます。',
    'sync.trying': '送信しています…', 'sync.done': 'すべて送信しました。', 'sync.wait': 'まだ送信中です。電波のある所でアプリを開いたままにしてください。',
    'err.write': 'サーバーへの保存でエラー:{msg}'
  }
};

const HELP = {
  pt: `
<h2>Como usar</h2>
<h3>1. Antes de ir ao campo (com rede)</h3>
<ol><li>Abra a app uma vez com rede e entre com a conta Google. Depois funciona sem rede.</li>
<li>No Chrome: menu ⋮ → <b>Adicionar ao ecrã principal</b>, para abrir como uma app.</li>
<li>Ligue a localização do telemóvel (modo de alta precisão).</li></ol>
<h3>2. Registar uma área (campo, viveiro, bloco)</h3>
<ol><li>Carregue em <b>Novo registo</b> → <b>Área</b>.</li>
<li><b>Andar à volta</b>: vá ao ponto de partida, carregue em <b>Começar</b> e ande pela borda até voltar ao início. Os pontos são marcados sozinhos.</li>
<li><b>Marcar os cantos</b> (campos retangulares): em cada canto fique parado e carregue em <b>Marcar este canto</b>. A app faz a média de alguns segundos de GPS.</li>
<li><b>Tocar no mapa</b>: só para lugares onde não pode ir (não é medição GPS).</li>
<li>Carregue em <b>Terminar</b>, escreva o nome e o grupo/localidade e <b>Guardar</b>. A área em hectares aparece na hora.</li></ol>
<h3>3. Para medir bem</h3>
<ul><li>Espere até o GPS (canto superior direito) mostrar <b>±5 m</b> ou menos (verde).</li>
<li><b>Mantenha o ecrã ligado</b> e esta app aberta enquanto anda. Com o ecrã desligado ou noutra app, o GPS para.</li>
<li>Árvores e casas pioram o sinal. Se puder, ande pelo lado aberto.</li>
<li>O erro do GPS do telemóvel é de 3–10 m. Em campos pequenos o erro da área é maior. Para comparar, meça duas vezes.</li></ul>
<h3>4. Sem rede</h3>
<ul><li>Os registos ficam guardados no telemóvel (“por enviar”). Quando houver rede, com a app aberta, são enviados sozinhos.</li>
<li>Sem rede a imagem de satélite não aparece (o Google não permite guardá-la). A app usa o <b>mapa simples</b>: grelha com escala, a sua posição e os registos.</li>
<li>No fim do dia, com rede, abra a app e veja se diz <b>Enviado</b>.</li></ul>
<h3>5. Partilhar</h3>
<ul><li>Todos os membros da equipa veem os registos de todos.</li>
<li>Num registo: <b>Partilhar texto</b> (área + link do Google Maps para o WhatsApp) ou <b>Enviar KML</b> (ficheiro para Google Earth).</li>
<li>Menu → <b>Exportar</b>: KML (Google Earth / My Maps), CSV (Excel), GeoJSON (QGIS).</li>
<li>Menu → <b>Importar</b>: traga medições antigas em KML (por exemplo do GPS Fields Area Measure).</li></ul>`,
  ja: `
<h2>使い方</h2>
<h3>1. 現場に行く前に(電波のある所で)</h3>
<ol><li>電波のある所で一度アプリを開き、Googleでログインします。その後は圏外でも動きます。</li>
<li>Chrome のメニュー ⋮ →「<b>ホーム画面に追加</b>」で、アプリのように開けます。</li>
<li>スマホの位置情報をオン(高精度)にします。</li></ol>
<h3>2. 区画(圃場・苗畑・ブロック)を記録する</h3>
<ol><li>「<b>新しく記録</b>」→「<b>区画(面)</b>」。</li>
<li><b>外周を歩く</b>:出発点で「<b>開始</b>」を押し、縁を歩いて出発点まで戻ります。点は自動で打たれます。</li>
<li><b>角を記録</b>(長方形の圃場):角ごとに立ち止まり「<b>この角を記録</b>」。数秒分のGPSを平均します。</li>
<li><b>地図をタップ</b>:立ち入れない場所だけ(GPSの実測ではありません)。</li>
<li>「<b>終了</b>」→ 名前とグループ/地域を入れて「<b>保存</b>」。面積(ha)はその場で出ます。</li></ol>
<h3>3. 正確に測るには</h3>
<ul><li>右上のGPSが <b>±5 m</b> 以下(緑)になるまで待ちます。</li>
<li>歩いている間は<b>画面を点けたまま</b>、このアプリを開いたままにします。画面が消える・別アプリに切り替えるとGPSが止まります。</li>
<li>木や建物の近くは精度が落ちます。開けた側を歩けるなら、そちらを歩きます。</li>
<li>スマホのGPSの誤差は 3〜10 m です。小さい圃場ほど面積の誤差は大きくなります。比べたいときは2回測ります。</li></ul>
<h3>4. 圏外のとき</h3>
<ul><li>記録は端末に保存されます(「未送信」)。電波が戻り、アプリを開いていれば自動で送信されます。</li>
<li>圏外では衛星写真は出ません(Google の規約で保存できないため)。<b>簡易地図</b>(方眼・縮尺・現在地・記録)で表示します。</li>
<li>1日の終わりに電波のある所でアプリを開き、「<b>送信済み</b>」になっているか確かめます。</li></ul>
<h3>5. 共有</h3>
<ul><li>チームの全員が、全員の記録を見られます。</li>
<li>記録を開いて「<b>文章で共有</b>」(面積と Google マップのリンクを WhatsApp へ)、「<b>KMLを送る</b>」(Google Earth 用のファイル)。</li>
<li>メニュー →「<b>書き出し</b>」:KML(Google Earth/マイマップ)、CSV(Excel)、GeoJSON(QGIS)。</li>
<li>メニュー →「<b>読み込み</b>」:GPS Fields Area Measure などの KML を取り込めます。</li></ul>`
};

let lang = 'pt';

export function initLang(saved) {
  if (saved === 'pt' || saved === 'ja') lang = saved;
  else lang = (navigator.language || '').toLowerCase().startsWith('ja') ? 'ja' : 'pt';
  document.documentElement.lang = lang;
}

export function getLang() { return lang; }

export function setLang(l) {
  lang = l === 'ja' ? 'ja' : 'pt';
  document.documentElement.lang = lang;
}

export function t(key, vars) {
  let s = (DICT[lang] && DICT[lang][key]) ?? DICT.pt[key] ?? key;
  if (vars) s = s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] == null ? '' : String(vars[k])));
  return s;
}

export function applyI18n(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  root.querySelectorAll('[data-i18n-ph]').forEach((el) => { el.placeholder = t(el.dataset.i18nPh); });
  root.querySelectorAll('[data-i18n-title]').forEach((el) => { el.title = t(el.dataset.i18nTitle); el.setAttribute('aria-label', t(el.dataset.i18nTitle)); });
}

export function helpHtml() { return HELP[lang] || HELP.pt; }

/** 分類の表示名(どちらの言語でも)または key から key を返す。読み込み用。見つからなければ ''。 */
export function categoryKeyFromLabel(label) {
  const s = String(label || '').trim().toLowerCase();
  if (!s) return '';
  for (const l of Object.keys(DICT)) {
    for (const [k, v] of Object.entries(DICT[l])) {
      if (k.startsWith('cat.') && (v.toLowerCase() === s || k.slice(4) === s)) return k.slice(4);
    }
  }
  return '';
}

export const _DICT = DICT;   // テストで両言語のキーが揃っているか確かめる用
