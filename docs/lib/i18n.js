/* field_gps_map — 表示の言語(ポルトガル語 / 英語 / 日本語)。
 * 現場のスタッフはポルトガル語、上司・外部は英語、Kazさんは日本語。
 * 端末の言語が ja なら日本語、en なら英語、それ以外はポルトガル語で始まり、
 * メニューからいつでも切り替えられる。
 * モザンビークの表記(欧州ポルトガル語寄り: registo, ecrã, telemóvel)に合わせる。
 */
export const LANGS = ['pt', 'en', 'ja'];
export const LANG_NAMES = { pt: 'Português', en: 'English', ja: '日本語' };

const DICT = {
  pt: {
    'common.back': 'Voltar', 'common.cancel': 'Cancelar', 'common.close': 'Fechar', 'common.ok': 'OK',

    'login.lead': 'Registe campos, linhas e pontos com o GPS do telemóvel — mesmo sem rede — e partilhe com a equipa.',
    'login.p1': 'Funciona sem rede: os registos ficam no telemóvel e são enviados sozinhos quando houver rede.',
    'login.p2': 'Ande à volta do campo e toque num botão em cada canto. A área em hectares aparece na hora.',
    'login.p3': 'Fotos do campo, mapa de satélite do Google e exportação para Google Earth e Excel.',
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

    'menu.open': 'Menu', 'menu.export': 'Exportar (Google Earth, Excel)',
    'menu.import': 'Importar KML', 'menu.help': 'Como usar',
    'menu.lang': 'Língua / Language / 言語', 'menu.update': 'Procurar atualização',
    'menu.signout': 'Sair', 'menu.leaveDemo': 'Sair do modo de teste',
    'menu.signout.rec': 'Há uma gravação em curso. Sair mesmo assim? (o rascunho fica guardado neste telemóvel)',

    'off.ready': 'Pronto para usar sem rede',
    'off.notReady': 'Ainda não está pronto para usar sem rede — mantenha a app aberta com rede um momento',
    'off.pending': 'Por enviar: {n}', 'off.allSent': 'Tudo enviado', 'off.demo': 'Modo de teste: nada é enviado',
    'off.lastSync': 'Última ligação ao servidor: {time}', 'off.never': 'Ainda sem ligação ao servidor',

    'off.map.title': 'Mapa para usar sem rede',
    'off.map.note': 'Guarda no telemóvel o mapa à volta do centro do mapa (OpenStreetMap). «Esta zona»: quadrado de {km} km com casas. «Zona larga»: raio de {r} km, só estradas, rios e povoações. Na zona de Malema a Ribáue guarda também a imagem de satélite Sentinel-2 (cada ponto = 10 m; vê-se estradas e machambas, não os detalhes). Sem rede, aparece no mapa simples. A imagem do Google não pode ser guardada.',
    'off.map.save': 'Guardar esta zona ({km} km, com casas)',
    'off.map.busy': 'A descarregar o mapa… (pode levar 1 a 3 minutos)',
    'off.map.done': 'Mapa guardado: {name} ({n} elementos). Já pode usar sem rede.',
    'off.map.fail': 'Não foi possível descarregar o mapa. Tente de novo daqui a pouco.',
    'off.map.offline': 'Sem rede. Guarde o mapa num lugar com rede (antes de ir ao campo).',
    'off.map.item': '{date} · {n} elementos',
    'off.map.remove': 'Apagar mapa',
    'off.map.removeConfirm': 'Apagar o mapa guardado de “{name}”? (os registos não são apagados)',
    'off.map.count': 'Mapas guardados para usar sem rede: {n}',
    'off.map.none': 'Ainda sem mapa guardado — botão do mapa → Guardar esta zona',
    'off.map.saveWide': 'Guardar zona larga (raio {r} km)',
    'off.map.busySat': 'A descarregar a imagem de satélite… {done}/{total}',
    'off.map.doneSat': 'Mapa guardado: {name} ({n} elementos, {sat} imagens de satélite). Já pode usar sem rede.',
    'off.map.kindNear': '{km} km',
    'off.map.kindWide': 'raio {r} km',
    'off.map.withSat': 'com satélite',
    'upd.checking': 'A procurar atualização…', 'upd.latest': 'Já tem a versão mais recente (v{v}).',
    'upd.found': 'Versão nova encontrada. A app vai recarregar dentro de segundos.',
    'upd.offline': 'Sem rede: não é possível procurar atualização agora.',
    'upd.unsupported': 'Este navegador não suporta atualização automática. Recarregue a página.',
    'upd.done': 'App atualizada para a v{v}.',
    'upd.deferred': 'Há uma versão nova. Atualiza sozinha quando terminar a gravação.',

    'map.layers': 'Tipo de mapa', 'map.locate': 'A minha posição',

    'map.simpleTag': 'Mapa simples (o mapa guardado) — funciona sem rede',
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

    'new.button': 'Novo registo', 'new.title': 'O que quer registar?',

    'kind.polygon': 'Área', 'kind.polygon.d': 'Campo, viveiro, bloco (ha)',
    'kind.line': 'Linha', 'kind.line.d': 'Rio, caminho, sebe (m)',
    'kind.point': 'Ponto', 'kind.point.d': 'Planta, poço, armazém',

 'method.import': 'Importado',







    'rec.vertices': 'Pontos', 'rec.area': 'Área', 'rec.perimeter': 'Perímetro', 'rec.length': 'Comprimento',
    'rec.accuracy': 'GPS', 'rec.coords': 'Coordenadas',
    'rec.undo': 'Desfazer', 'rec.finish': 'Terminar', 'rec.savePoint': 'Guardar ponto', 'rec.cancel': 'Cancelar gravação',
    'rec.cancel.yes': 'Sim, apagar', 'rec.confirmCancel': 'Apagar esta gravação? Os pontos marcados serão perdidos.',
    'rec.addCorner': 'Canto aqui', 'rec.addPoint': 'Ponto aqui', 'rec.here': 'Registar aqui', 'rec.again': 'Registar de novo',
    'rec.added': 'Ponto {n} marcado (±{acc} m).',
    'rec.addedLow': 'Ponto {n} marcado, mas a precisão está fraca (±{acc} m). Se quiser, “Desfazer” e marque de novo daqui a pouco.',
    'rec.waitGps': 'Ainda sem posição GPS. Espere uns segundos num lugar aberto.',
    'rec.dup': 'Tocou duas vezes no mesmo lugar — ignorado.',
    'rec.mode.gps': 'Andar (GPS)',
    'rec.mode.tap': 'Tocar no mapa',
    'd.tappedN': '{n} tocado(s) no mapa',
    'rec.goal': 'até ~10',
    'rec.hint.corners.polygon': 'Ande pela borda. Em cada canto, toque no botão verde. A área fecha sozinha.',
    'rec.hint.corners.line': 'Ande ao longo da linha. Em cada curva, toque no botão verde.',
    'rec.hint.tap.polygon': 'Toque no mapa em cada canto, por ordem. Pode voltar a “Andar” a qualquer momento.',
    'rec.hint.tap.line': 'Toque no mapa em cada ponto, por ordem.',
    'rec.hint.gps.point': 'No lugar do ponto, toque no botão verde.',
    'rec.hint.tap.point': 'Toque no mapa no lugar do ponto (pode tocar de novo para mudar).',
    'rec.warn.cross': 'As linhas da área cruzam-se (forma de “8”): a área pode estar errada. Use “Desfazer”.',
    'rec.warn.many': '{n} pontos. Não precisa de pontos nos lados retos — só nos cantos.',
    'rec.warn.lowAcc': 'Precisão GPS fraca agora (±{acc} m). Espere um pouco antes de marcar.',
    'rec.wasHidden': 'Atenção: com o ecrã desligado ou noutra app o GPS para. Volte à app antes de marcar o próximo canto.',
    'rec.err.none': 'Nada a guardar.', 'rec.err.poly': 'Uma área precisa de pelo menos 3 pontos.',
    'rec.err.line': 'Uma linha precisa de pelo menos 2 pontos.', 'rec.err.point': 'Ainda não há ponto.',
    'rec.resume': 'Há uma gravação não terminada (pontos: {n}). Continuar?',
    'rec.resume.yes': 'Continuar', 'rec.resume.no': 'Apagar',

    'save.title': 'Guardar registo', 'save.editTitle': 'Editar dados',
    'save.name': 'Nome *', 'save.category': 'Tipo', 'save.group': 'Grupo / Localidade',
    'save.group.ph': 'ex.: Malema 2, Netia-Sede', 'save.notes': 'Notas', 'save.ok': 'Guardar', 'save.photos': 'Fotos',
    'save.warn.tap': '{n} ponto(s) foram tocados no mapa (não medidos com GPS).',
    'save.ok.online': 'Guardado e enviado.', 'save.ok.offline': 'Guardado no telemóvel. Será enviado sozinho quando houver rede.',
    'save.ok.demo': 'Guardado neste telemóvel (modo de teste).', 'save.updated': 'Alterações guardadas.',

    'photo.add': 'Adicionar foto', 'photo.max': 'No máximo {n} fotos por registo.',
    'photo.busy': 'A preparar a foto…', 'photo.failed': 'Não foi possível ler a foto.',
    'photo.added': 'Foto adicionada.', 'photo.none': 'Sem fotos. Toque em + para tirar uma.',
    'photo.remove': 'Retirar foto', 'photo.removeConfirm': 'Retirar esta foto do registo?', 'photo.removed': 'Foto retirada.',
    'photo.pending': 'por enviar', 'photo.by': '{name} · {date}',

    'cat.field': 'Campo / machamba', 'cat.block': 'Bloco do campo', 'cat.nursery': 'Viveiro', 'cat.hedge': 'Sebe viva / vedação',
    'cat.water': 'Rio / água', 'cat.road': 'Caminho / estrada', 'cat.building': 'Edifício / armazém', 'cat.tree': 'Planta / árvore', 'cat.other': 'Outro',

    'list.title': 'Registos', 'list.search': 'Procurar nome, grupo, notas…', 'list.all': 'Todos',


    'list.summary': 'Registos: {n} · Áreas: {a} · Total: {ha} ha', 'list.empty': 'Ainda não há registos. Carregue em “Novo registo”.',
    'list.noMatch': 'Nenhum registo com este filtro.',

 'd.gmaps': 'Google Maps', 'd.share': 'Partilhar', 'd.kml': 'KML',
    'd.edit': 'Editar', 'd.archive': 'Arquivar', 'd.archive.confirm': 'Arquivar “{name}”? Deixa de aparecer na lista (não é apagado da base de dados).',
    'd.archived': 'Arquivado.', 'd.by': 'Registado por',

    'd.sync': 'Envio', 'd.sync.pending': 'À espera de rede (guardado no telemóvel)',
 'd.noName': '(sem nome)', 'd.appLink': 'Abrir na app',
    'd.copied': 'Texto copiado. Cole no WhatsApp.', 'd.copyPrompt': 'Copie o texto:',

    'exp.title': 'Exportar',
 'exp.count': 'Todos os registos: {n}',
    'exp.kml': 'Google Earth, Google My Maps (com as áreas)',
    'exp.csv': 'Excel (uma linha por registo, com área em ha)', 'exp.zip': 'Tudo junto: KML + Excel + GeoJSON (QGIS) + fotos',
    'exp.none': 'Não há registos para exportar.', 'exp.done': 'Exportado: {n} registo(s).', 'exp.busy': 'A juntar as fotos…',
    'exp.readme': 'Field GPS Map — exportação\r\n\r\nfield_gps_map.kml     Google Earth (Web: Projetos > Importar KML) ou Google My Maps (Importar).\r\nfield_gps_map.geojson QGIS: arrastar o ficheiro para o mapa. Coordenadas WGS84 (EPSG:4326).\r\nfield_gps_map.csv     Excel. area_ha = hectares; wkt = forma (QGIS: Texto delimitado > WKT).\r\nphotos/               Fotos de cada registo (nome do registo + número).\r\n',

    'imp.title': 'Importar', 'imp.lead': 'KML/KMZ (ex.: exportado do GPS Fields Area Measure ou Google Earth) ou GeoJSON. Cada área/linha/ponto vira um registo partilhado.',
    'imp.found': 'Encontrado — áreas: {p}, linhas: {l}, pontos: {pt}.', 'imp.error': 'Não foi possível ler o ficheiro.',
    'imp.ok': 'Importar', 'imp.unnamed': 'Importado {n}', 'imp.done': 'Importado: {n} registo(s).',

 'set.lang': 'Língua',
 'set.maxAcc.d': 'Se o GPS estiver pior do que isto ao marcar um canto, a app avisa. 10 m é um bom valor.',

 'set.mapMode.simple': 'Mapa simples (funciona sem rede)',
 'set.mapType.hybrid': 'Satélite com nomes', 'set.mapType.satellite': 'Satélite',
    'set.mapType.roadmap': 'Mapa', 'set.mapType.terrain': 'Relevo',

    'sync.demo': 'Teste', 'sync.ok': 'Enviado', 'sync.cache': 'Guardado', 'sync.offline': 'Sem rede',
    'sync.offlineN': 'Sem rede · {n} por enviar', 'sync.pending': '{n} por enviar', 'sync.badge': 'por enviar',
    'sync.demoHelp': 'Modo de teste: os dados ficam só neste telemóvel e não são partilhados.',
    'sync.offlineHelp': 'Sem rede. {n} registo(s) guardados no telemóvel serão enviados sozinhos quando houver rede (com a app aberta).',
    'sync.trying': 'A enviar…', 'sync.done': 'Tudo enviado.', 'sync.wait': 'Ainda a enviar. Mantenha a app aberta com rede.',
    'sync.sentN': 'A rede voltou: {n} registo(s) enviados.',
    'err.write': 'Erro ao guardar no servidor: {msg}'
  },

  en: {
    'common.back': 'Back', 'common.cancel': 'Cancel', 'common.close': 'Close', 'common.ok': 'OK',

    'login.lead': 'Record fields, lines and points with your phone’s GPS — even without signal — and share them with the team.',
    'login.p1': 'Works offline: records stay on the phone and upload by themselves when there is signal.',
    'login.p2': 'Walk around the field and tap a button at each corner. The area in hectares appears at once.',
    'login.p3': 'Field photos, Google satellite map, and export to Google Earth and Excel.',
    'login.google': 'Sign in with Google',
    'login.demo': 'Try without an account (this phone only)',
    'login.loading': 'Loading…',
    'login.checking': 'Checking access…',
    'login.opening': 'Opening the Google window…',
    'login.failed': 'Could not sign in ({msg}).',
    'login.error': 'Could not check access. Check the connection and try again. ({msg})',
    'denied.title': 'No access',
    'denied.text': 'The account {email} does not have access yet.',
    'denied.how': 'Ask the person in charge (Kaz) to add your e-mail to the list, then tap “Check again”.',
    'denied.recheck': 'Check again',
    'boot.title': 'Could not open',
    'boot.offline': 'No signal, and the app has not been opened on this phone with signal yet. Open it once with signal; after that it works offline.',
    'boot.failed': 'The app failed to load. Please try again.',
    'boot.retry': 'Try again',
    'demo.user': 'Test mode',
    'demo.note': 'Test mode — data stays on this phone only',

    'menu.open': 'Menu', 'menu.export': 'Export (Google Earth, Excel)',
    'menu.import': 'Import KML', 'menu.help': 'How to use',
    'menu.lang': 'Language / Língua / 言語', 'menu.update': 'Check for update',
    'menu.signout': 'Sign out', 'menu.leaveDemo': 'Leave test mode',
    'menu.signout.rec': 'A recording is in progress. Sign out anyway? (the draft stays on this phone)',

    'off.ready': 'Ready to use offline',
    'off.notReady': 'Not ready for offline use yet — keep the app open with signal for a moment',
    'off.pending': 'Waiting to send: {n}', 'off.allSent': 'Everything sent', 'off.demo': 'Test mode: nothing is sent',
    'off.lastSync': 'Last contact with the server: {time}', 'off.never': 'No contact with the server yet',

    'off.map.title': 'Map for use without signal',
    'off.map.note': 'Saves on the phone the map around the map centre (OpenStreetMap). “This area”: a {km} km square, with houses. “Wide area”: {r} km radius, roads, rivers and villages only. Between Malema and Ribáue it also saves Sentinel-2 satellite images (1 pixel = 10 m: roads and fields are visible, fine details are not). Without signal it appears on the simple map. Google images cannot be saved.',
    'off.map.save': 'Save this area ({km} km, with houses)',
    'off.map.busy': 'Downloading the map… (may take 1–3 minutes)',
    'off.map.done': 'Map saved: {name} ({n} items). Ready to use without signal.',
    'off.map.fail': 'Could not download the map. Please try again in a moment.',
    'off.map.offline': 'No signal. Save the map where there is signal (before going to the field).',
    'off.map.item': '{date} · {n} items',
    'off.map.remove': 'Delete map',
    'off.map.removeConfirm': 'Delete the saved map of “{name}”? (records are not deleted)',
    'off.map.count': 'Maps saved for offline use: {n}',
    'off.map.none': 'No offline map yet — map button → Save this area',
    'off.map.saveWide': 'Save wide area ({r} km radius)',
    'off.map.busySat': 'Downloading satellite images… {done}/{total}',
    'off.map.doneSat': 'Map saved: {name} ({n} items, {sat} satellite tiles). Ready to use without signal.',
    'off.map.kindNear': '{km} km',
    'off.map.kindWide': '{r} km radius',
    'off.map.withSat': 'with satellite',
    'upd.checking': 'Checking for update…', 'upd.latest': 'You have the latest version (v{v}).',
    'upd.found': 'New version found. The app will reload in a few seconds.',
    'upd.offline': 'No signal: cannot check for updates now.',
    'upd.unsupported': 'This browser does not support automatic updates. Reload the page.',
    'upd.done': 'App updated to v{v}.',
    'upd.deferred': 'A new version is available. It will update by itself when the recording ends.',

    'map.layers': 'Map type', 'map.locate': 'My location',

    'map.simpleTag': 'Simple map (your saved map) — works without signal',
    'map.offlineBanner': 'No signal: the satellite image may not load. You can keep recording.',
    'map.onlineBanner': 'Signal is back.',
    'map.useSimple': 'Use simple map', 'map.useGoogle': 'Show satellite',
    'map.tilesFail': 'The Google map did not load.',
    'map.googleFail': 'Google Maps is not available now (no signal?). Using the simple map.',

    'gps.wait': 'GPS…', 'gps.off': 'GPS off',
    'gps.waiting': 'Waiting for GPS. Stand in an open place (no trees overhead) for 1–2 minutes.',
    'gps.denied': 'Location is blocked. Turn on the phone’s location and allow it for this site (lock icon next to the address → Permissions → Location).',
    'gps.unavailable': 'GPS is not available on this device/browser.',
    'gps.detail': 'Accuracy ±{acc} m ({age} s ago). {lat}, {lng}. Smaller is better: wait until it is under 5–10 m.',

    'new.button': 'New record', 'new.title': 'What do you want to record?',

    'kind.polygon': 'Area', 'kind.polygon.d': 'Field, nursery, block (ha)',
    'kind.line': 'Line', 'kind.line.d': 'River, path, hedge (m)',
    'kind.point': 'Point', 'kind.point.d': 'Plant, well, store',

 'method.import': 'Imported',







    'rec.vertices': 'Points', 'rec.area': 'Area', 'rec.perimeter': 'Perimeter', 'rec.length': 'Length',
    'rec.accuracy': 'GPS', 'rec.coords': 'Coordinates',
    'rec.undo': 'Undo', 'rec.finish': 'Finish', 'rec.savePoint': 'Save point', 'rec.cancel': 'Cancel recording',
    'rec.cancel.yes': 'Yes, delete', 'rec.confirmCancel': 'Delete this recording? The marked points will be lost.',
    'rec.addCorner': 'Corner here', 'rec.addPoint': 'Point here', 'rec.here': 'Record here', 'rec.again': 'Record again',
    'rec.added': 'Point {n} marked (±{acc} m).',
    'rec.addedLow': 'Point {n} marked, but accuracy is poor (±{acc} m). If you like, “Undo” and mark again in a moment.',
    'rec.waitGps': 'No GPS position yet. Wait a few seconds in an open place.',
    'rec.dup': 'Tapped twice at the same place — ignored.',
    'rec.mode.gps': 'Walk (GPS)',
    'rec.mode.tap': 'Tap on map',
    'd.tappedN': '{n} tapped on map',
    'rec.goal': 'up to ~10',
    'rec.hint.corners.polygon': 'Walk along the edge. At each corner, tap the green button. The area closes by itself.',
    'rec.hint.corners.line': 'Walk along the line. At each bend, tap the green button.',
    'rec.hint.tap.polygon': 'Tap each corner on the map, in order. You can switch back to “Walk” at any time.',
    'rec.hint.tap.line': 'Tap each point on the map, in order.',
    'rec.hint.gps.point': 'At the spot, tap the green button.',
    'rec.hint.tap.point': 'Tap the spot on the map (tap again to move it).',
    'rec.warn.cross': 'The area’s edges cross (figure “8”): the area may be wrong. Use “Undo”.',
    'rec.warn.many': '{n} points. Straight sides need no points — corners only.',
    'rec.warn.lowAcc': 'GPS accuracy is poor right now (±{acc} m). Wait a little before marking.',
    'rec.wasHidden': 'Note: with the screen off or in another app the GPS stops. Come back to the app before marking the next corner.',
    'rec.err.none': 'Nothing to save.', 'rec.err.poly': 'An area needs at least 3 points.',
    'rec.err.line': 'A line needs at least 2 points.', 'rec.err.point': 'No point yet.',
    'rec.resume': 'There is an unfinished recording ({n} points). Continue?',
    'rec.resume.yes': 'Continue', 'rec.resume.no': 'Delete',

    'save.title': 'Save record', 'save.editTitle': 'Edit details',
    'save.name': 'Name *', 'save.category': 'Type', 'save.group': 'Group / Locality',
    'save.group.ph': 'e.g. Malema 2, Netia-Sede', 'save.notes': 'Notes', 'save.ok': 'Save', 'save.photos': 'Photos',
    'save.warn.tap': '{n} point(s) were tapped on the map (not measured by GPS).',
    'save.ok.online': 'Saved and sent.', 'save.ok.offline': 'Saved on the phone. It will be sent by itself when there is signal.',
    'save.ok.demo': 'Saved on this phone (test mode).', 'save.updated': 'Changes saved.',

    'photo.add': 'Add photo', 'photo.max': 'Up to {n} photos per record.',
    'photo.busy': 'Preparing the photo…', 'photo.failed': 'Could not read the photo.',
    'photo.added': 'Photo added.', 'photo.none': 'No photos. Tap + to take one.',
    'photo.remove': 'Remove photo', 'photo.removeConfirm': 'Remove this photo from the record?', 'photo.removed': 'Photo removed.',
    'photo.pending': 'not sent', 'photo.by': '{name} · {date}',

    'cat.field': 'Field / machamba', 'cat.block': 'Field block', 'cat.nursery': 'Nursery', 'cat.hedge': 'Hedge / fence',
    'cat.water': 'River / water', 'cat.road': 'Path / road', 'cat.building': 'Building / store', 'cat.tree': 'Plant / tree', 'cat.other': 'Other',

    'list.title': 'Records', 'list.search': 'Search name, group, notes…', 'list.all': 'All',


    'list.summary': 'Records: {n} · Areas: {a} · Total: {ha} ha', 'list.empty': 'No records yet. Tap “New record”.',
    'list.noMatch': 'No records match this filter.',

 'd.gmaps': 'Google Maps', 'd.share': 'Share', 'd.kml': 'KML',
    'd.edit': 'Edit', 'd.archive': 'Archive', 'd.archive.confirm': 'Archive “{name}”? It disappears from the list (it is not deleted from the database).',
    'd.archived': 'Archived.', 'd.by': 'Recorded by',

    'd.sync': 'Upload', 'd.sync.pending': 'Waiting for signal (saved on the phone)',
 'd.noName': '(no name)', 'd.appLink': 'Open in the app',
    'd.copied': 'Text copied. Paste it in WhatsApp.', 'd.copyPrompt': 'Copy the text:',

    'exp.title': 'Export',
 'exp.count': 'All records: {n}',
    'exp.kml': 'Google Earth, Google My Maps (with the areas)',
    'exp.csv': 'Excel (one row per record, with area in ha)', 'exp.zip': 'Everything: KML + Excel + GeoJSON (QGIS) + photos',
    'exp.none': 'No records to export.', 'exp.done': 'Exported: {n} record(s).', 'exp.busy': 'Collecting the photos…',
    'exp.readme': 'Field GPS Map — export\r\n\r\nfield_gps_map.kml     Google Earth (Web: Projects > Import KML file) or Google My Maps (Import).\r\nfield_gps_map.geojson QGIS: drag the file onto the map. Coordinates WGS84 (EPSG:4326).\r\nfield_gps_map.csv     Excel. area_ha = hectares; wkt = shape (QGIS: Delimited text > WKT).\r\nphotos/               Photos of each record (record name + number).\r\n',

    'imp.title': 'Import', 'imp.lead': 'KML/KMZ (e.g. exported from GPS Fields Area Measure or Google Earth) or GeoJSON. Each area/line/point becomes a shared record.',
    'imp.found': 'Found — areas: {p}, lines: {l}, points: {pt}.', 'imp.error': 'Could not read the file.',
    'imp.ok': 'Import', 'imp.unnamed': 'Imported {n}', 'imp.done': 'Imported: {n} record(s).',

 'set.lang': 'Language',
 'set.maxAcc.d': 'If GPS is worse than this when you mark a corner, the app warns you. 10 m is a good value.',

 'set.mapMode.simple': 'Simple map (works without signal)',
 'set.mapType.hybrid': 'Satellite with labels', 'set.mapType.satellite': 'Satellite',
    'set.mapType.roadmap': 'Map', 'set.mapType.terrain': 'Terrain',

    'sync.demo': 'Test', 'sync.ok': 'Sent', 'sync.cache': 'Saved', 'sync.offline': 'Offline',
    'sync.offlineN': 'Offline · {n} to send', 'sync.pending': '{n} to send', 'sync.badge': 'not sent',
    'sync.demoHelp': 'Test mode: data stays on this phone and is not shared.',
    'sync.offlineHelp': 'No signal. {n} record(s) saved on the phone will be sent by themselves when there is signal (with the app open).',
    'sync.trying': 'Sending…', 'sync.done': 'Everything sent.', 'sync.wait': 'Still sending. Keep the app open with signal.',
    'sync.sentN': 'Signal is back: {n} record(s) sent.',
    'err.write': 'Error saving to the server: {msg}'
  },

  ja: {
    'common.back': '戻る', 'common.cancel': 'キャンセル', 'common.close': '閉じる', 'common.ok': 'OK',

    'login.lead': 'スマホのGPSで区画・線・地点を記録し、チームで共有するアプリです。電波が無くても記録できます。',
    'login.p1': '圏外でも記録できます。記録は端末に保存され、電波が戻ると自動で送信されます。',
    'login.p2': '圃場の縁を歩き、角でボタンをタップするだけ。面積(ha)がその場で出ます。',
    'login.p3': '圃場の写真、Google マップの衛星写真、Google Earth・Excel への書き出し。',
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

    'menu.open': 'メニュー', 'menu.export': '書き出し(Google Earth・Excel)',
    'menu.import': 'KML の読み込み', 'menu.help': '使い方',
    'menu.lang': '言語 / Language / Língua', 'menu.update': 'アップデートを確認',
    'menu.signout': 'ログアウト', 'menu.leaveDemo': '試用モードを終える',
    'menu.signout.rec': '記録の途中です。ログアウトしますか?(下書きはこの端末に残ります)',

    'off.ready': '圏外で使う準備ができています',
    'off.notReady': 'まだ圏外で使う準備ができていません。電波のある所で少しアプリを開いたままにしてください',
    'off.pending': '未送信 {n} 件', 'off.allSent': 'すべて送信済み', 'off.demo': '試用モード:送信はしません',
    'off.lastSync': 'サーバーと最後につながった時刻:{time}', 'off.never': 'まだサーバーとつながっていません',

    'off.map.title': '圏外用の地図',
    'off.map.note': '地図の真ん中のまわりを、この端末に保存します(OpenStreetMap)。「この辺り」は {km} km 四方で家まで。「広い範囲」は半径 {r} km で、道・川・集落名だけ。Malema〜Ribáue 周辺では衛星写真(Sentinel-2、1画素 10 m。道や畑は見えるが細かい所は見えない)も一緒に保存します。圏外では簡易地図に出ます。Google の画像は保存できません。',
    'off.map.save': 'この辺りを保存({km} km 四方・家まで)',
    'off.map.busy': '地図を取り込んでいます…(1〜3分かかることがあります)',
    'off.map.done': '地図を保存しました:{name}({n} 件)。圏外でも使えます。',
    'off.map.fail': '地図を取り込めませんでした。少し待ってもう一度お試しください。',
    'off.map.offline': '圏外です。電波のある所で(現場に行く前に)保存してください。',
    'off.map.item': '{date} · {n} 件',
    'off.map.remove': '地図を削除',
    'off.map.removeConfirm': '「{name}」の保存した地図を削除しますか?(記録は消えません)',
    'off.map.count': '圏外用の地図:{n} か所 保存済み',
    'off.map.none': '圏外用の地図はまだありません — 地図ボタン →「この辺りを保存」',
    'off.map.saveWide': '広い範囲を保存(半径 {r} km)',
    'off.map.busySat': '衛星写真を取り込んでいます… {done}/{total}',
    'off.map.doneSat': '地図を保存しました:{name}({n} 件、衛星写真 {sat} 枚)。圏外でも使えます。',
    'off.map.kindNear': '{km} km 四方',
    'off.map.kindWide': '半径 {r} km',
    'off.map.withSat': '衛星写真あり',
    'upd.checking': 'アップデートを確認しています…', 'upd.latest': '最新版です(v{v})。',
    'upd.found': '新しい版が見つかりました。数秒で再読み込みします。',
    'upd.offline': '圏外なので、いまは確認できません。',
    'upd.unsupported': 'このブラウザは自動更新に対応していません。ページを再読み込みしてください。',
    'upd.done': 'v{v} に更新しました。',
    'upd.deferred': '新しい版があります。記録が終わったら自動で更新します。',

    'map.layers': '地図の種類', 'map.locate': '現在地',

    'map.simpleTag': '簡易地図(保存した地図)— 圏外でも動きます',
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

    'new.button': '新しく記録', 'new.title': '何を記録しますか?',

    'kind.polygon': '区画', 'kind.polygon.d': '圃場・苗畑・ブロック(ha)',
    'kind.line': '線', 'kind.line.d': '川・道・生垣(m)',
    'kind.point': '地点', 'kind.point.d': '株・井戸・倉庫',

 'method.import': '読み込み',







    'rec.vertices': '点の数', 'rec.area': '面積', 'rec.perimeter': '外周', 'rec.length': '長さ',
    'rec.accuracy': 'GPS', 'rec.coords': '座標',
    'rec.undo': '1つ戻す', 'rec.finish': '終了', 'rec.savePoint': 'この地点を保存', 'rec.cancel': '記録をやめる',
    'rec.cancel.yes': 'はい、消す', 'rec.confirmCancel': 'この記録を消しますか?打った点は失われます。',
    'rec.addCorner': 'ここを角に', 'rec.addPoint': 'ここに点', 'rec.here': 'ここを記録', 'rec.again': '記録し直す',
    'rec.added': '{n} 点目を追加しました(±{acc} m)。',
    'rec.addedLow': '{n} 点目を追加しましたが、精度が悪い状態です(±{acc} m)。必要なら「1つ戻す」で少し待って打ち直してください。',
    'rec.waitGps': 'まだGPSの位置が取れていません。開けた場所で数秒待ってください。',
    'rec.dup': '同じ場所で2回押したようです。2回目は無視しました。',
    'rec.mode.gps': '歩いて(GPS)',
    'rec.mode.tap': '地図をタップ',
    'd.tappedN': '地図タップ {n}',
    'rec.goal': '10個以内が目安',
    'rec.hint.corners.polygon': '縁を歩き、角ごとに緑のボタンをタップ。区画は自動で閉じます。',
    'rec.hint.corners.line': '線に沿って歩き、曲がり角ごとに緑のボタンをタップ。',
    'rec.hint.tap.polygon': '地図上の角を順にタップ。いつでも「歩いて」に戻せます。',
    'rec.hint.tap.line': '順番に、地図上の点をタップしてください。',
    'rec.hint.gps.point': 'その場所で緑のボタンをタップしてください。',
    'rec.hint.tap.point': '地図上でその場所をタップ(もう一度タップすると置き直し)。',
    'rec.warn.cross': '区画の線が交差しています(8の字)。面積が正しくない可能性があります。「1つ戻す」で直してください。',
    'rec.warn.many': '点が {n} 個あります。まっすぐな辺の途中には点は要りません(角だけで十分)。',
    'rec.warn.lowAcc': 'いまGPSの精度が悪い状態です(±{acc} m)。少し待ってから打ってください。',
    'rec.wasHidden': '注意:画面が消えたり別のアプリに切り替えたりするとGPSが止まります。次の角を打つ前にアプリに戻ってください。',
    'rec.err.none': '保存するものがありません。', 'rec.err.poly': '区画には点が3つ以上必要です。',
    'rec.err.line': '線には点が2つ以上必要です。', 'rec.err.point': 'まだ地点がありません。',
    'rec.resume': '終わっていない記録(点 {n} 個)があります。続けますか?',
    'rec.resume.yes': '続ける', 'rec.resume.no': '消す',

    'save.title': '記録を保存', 'save.editTitle': '情報を編集',
    'save.name': '名前 *', 'save.category': '種類', 'save.group': 'グループ / 地域',
    'save.group.ph': '例:Malema 2、Netia-Sede', 'save.notes': 'メモ', 'save.ok': '保存', 'save.photos': '写真',
    'save.warn.tap': '{n} 個の点は地図のタップで置いたものです(GPSの実測ではありません)。',
    'save.ok.online': '保存して送信しました。', 'save.ok.offline': '端末に保存しました。電波が戻ると自動で送信されます。',
    'save.ok.demo': 'この端末に保存しました(試用モード)。', 'save.updated': '変更を保存しました。',

    'photo.add': '写真を追加', 'photo.max': '写真は1件につき {n} 枚までです。',
    'photo.busy': '写真を準備しています…', 'photo.failed': '写真を読み込めませんでした。',
    'photo.added': '写真を追加しました。', 'photo.none': '写真はまだありません。+ で撮影できます。',
    'photo.remove': '写真を外す', 'photo.removeConfirm': 'この写真を記録から外しますか?', 'photo.removed': '写真を外しました。',
    'photo.pending': '未送信', 'photo.by': '{name} · {date}',

    'cat.field': '圃場・畑', 'cat.block': '圃場の区画(ブロック)', 'cat.nursery': '苗畑', 'cat.hedge': '生垣・フェンス',
    'cat.water': '川・水源', 'cat.road': '道', 'cat.building': '建物・倉庫', 'cat.tree': '株・木', 'cat.other': 'その他',

    'list.title': '記録', 'list.search': '名前・グループ・メモで検索…', 'list.all': 'すべて',


    'list.summary': '{n} 件 · 区画 {a} 件 · 合計 {ha} ha', 'list.empty': 'まだ記録がありません。「新しく記録」を押してください。',
    'list.noMatch': 'この条件に合う記録はありません。',

 'd.gmaps': 'Google マップ', 'd.share': '共有', 'd.kml': 'KML',
    'd.edit': '編集', 'd.archive': 'アーカイブ', 'd.archive.confirm': '「{name}」をアーカイブしますか?一覧から消えます(データベースからは消えません)。',
    'd.archived': 'アーカイブしました。', 'd.by': '記録者',

    'd.sync': '送信', 'd.sync.pending': '電波待ち(端末に保存済み)',
 'd.noName': '(名前なし)', 'd.appLink': 'アプリで開く',
    'd.copied': '文章をコピーしました。WhatsApp などに貼り付けてください。', 'd.copyPrompt': '次の文章をコピーしてください:',

    'exp.title': '書き出し',
 'exp.count': '全部の記録:{n} 件',
    'exp.kml': 'Google Earth・Google マイマップ用(区画の形も入ります)',
    'exp.csv': 'Excel 用(1行1件、面積 ha つき)', 'exp.zip': 'まとめて:KML+Excel+GeoJSON(QGIS)+写真',
    'exp.none': '書き出す記録がありません。', 'exp.done': '{n} 件を書き出しました。', 'exp.busy': '写真を集めています…',
    'exp.readme': 'Field GPS Map 書き出し\r\n\r\nfield_gps_map.kml     Google Earth(Web版:プロジェクト > KMLファイルをインポート)、Google マイマップ(インポート)。\r\nfield_gps_map.geojson QGIS:ファイルを地図にドラッグ。座標は WGS84(EPSG:4326)。\r\nfield_gps_map.csv     Excel。area_ha = ヘクタール、wkt = 形(QGIS:区切りテキスト > WKT)。\r\nphotos/               記録ごとの写真(記録の名前+番号)。\r\n',

    'imp.title': '読み込み', 'imp.lead': 'KML/KMZ(GPS Fields Area Measure や Google Earth から書き出したもの)か GeoJSON。区画・線・地点が1件ずつ共有の記録になります。',
    'imp.found': '区画 {p} 件、線 {l} 件、地点 {pt} 件が見つかりました。', 'imp.error': 'ファイルを読めませんでした。',
    'imp.ok': '読み込む', 'imp.unnamed': '読み込み {n}', 'imp.done': '{n} 件を読み込みました。',

 'set.lang': '言語',
 'set.maxAcc.d': '角を打つときのGPSの誤差がこれより大きいと警告します。10 m が目安です。',

 'set.mapMode.simple': '簡易地図(圏外でも動く)',
 'set.mapType.hybrid': '航空写真+地名', 'set.mapType.satellite': '航空写真',
    'set.mapType.roadmap': '地図', 'set.mapType.terrain': '地形',

    'sync.demo': '試用', 'sync.ok': '送信済み', 'sync.cache': '保存済み', 'sync.offline': '圏外',
    'sync.offlineN': '圏外 · 未送信 {n} 件', 'sync.pending': '未送信 {n} 件', 'sync.badge': '未送信',
    'sync.demoHelp': '試用モードです。データはこの端末にだけあり、共有されません。',
    'sync.offlineHelp': '圏外です。端末に保存された {n} 件は、電波が戻ると(アプリを開いている間に)自動で送信されます。',
    'sync.trying': '送信しています…', 'sync.done': 'すべて送信しました。', 'sync.wait': 'まだ送信中です。電波のある所でアプリを開いたままにしてください。',
    'sync.sentN': '電波が戻り、{n} 件を送信しました。',
    'err.write': 'サーバーへの保存でエラー:{msg}'
  }
};

const HELP = {
  pt: `
<h2>Como usar</h2>
<h3>1. Antes de ir ao campo (com rede)</h3>
<ol><li>Abra a app uma vez com rede e entre com a conta Google. No menu deve aparecer <b>Pronto para usar sem rede</b>.</li>
<li>No Chrome: menu ⋮ → <b>Adicionar ao ecrã principal</b>.</li>
<li>Mova o mapa para a zona de trabalho → botão do mapa (canto direito) → <b>Guardar esta zona</b> (casas, 10 km) ou <b>Guardar zona larga</b> (raio 100 km). Repita para cada zona. Entre Malema e Ribáue guarda também a imagem de satélite.</li></ol>
<h3>2. Registar um campo</h3>
<ol><li><b>Novo registo</b> → <b>Área</b>. A gravação começa logo.</li>
<li>Ande pela borda e, em cada canto, toque em <b>Canto aqui</b>. A posição entra na hora. Normalmente bastam 4–10 pontos.</li>
<li>Não precisa de voltar ao primeiro canto: a área fecha sozinha.</li>
<li><b>Terminar</b> → nome e, se quiser, <b>fotos</b> → <b>Guardar</b>.</li></ol>
<p>Lugar onde não pode ir? Durante a gravação, mude para <b>Tocar no mapa</b> e toque nos cantos no mapa.</p>
<h3>3. Para medir bem</h3>
<ul><li>Veja o GPS no canto superior direito: <b>±5 m</b> ou menos (verde) é bom.</li>
<li>Marcou mal? <b>Desfazer</b> apaga o último ponto.</li></ul>
<h3>4. Sem rede</h3>
<ul><li>Os registos e as fotos ficam no telemóvel e são enviados sozinhos quando houver rede — com a app aberta.</li>
<li>Sem rede a imagem de satélite não aparece. O <b>mapa simples</b> mostra as estradas, rios e casas do mapa guardado.</li></ul>
<h3>5. Partilhar</h3>
<ul><li>Num registo: <b>Partilhar</b> (texto + fotos para o WhatsApp), <b>Google Maps</b> ou <b>KML</b> (Google Earth).</li>
<li>Menu → <b>Exportar</b>: Google Earth, Excel, ou tudo num ZIP com fotos.</li>
<li>A app atualiza-se sozinha.</li></ul>`,
  en: `
<h2>How to use</h2>
<h3>1. Before going to the field (with signal)</h3>
<ol><li>Open the app once with signal and sign in with Google. The menu should say <b>Ready to use offline</b>.</li>
<li>In Chrome: menu ⋮ → <b>Add to Home screen</b>.</li>
<li>Move the map to the work area → map button (right side) → <b>Save this area</b> (houses, 10 km) or <b>Save wide area</b> (100 km radius). Repeat for each area. Between Malema and Ribáue the satellite image is saved too.</li></ol>
<h3>2. Record a field</h3>
<ol><li><b>New record</b> → <b>Area</b>. Recording starts at once.</li>
<li>Walk along the edge and, at each corner, tap <b>Corner here</b>. The position is added instantly. Usually 4–10 points are enough.</li>
<li>No need to go back to the first corner: the area closes by itself.</li>
<li><b>Finish</b> → name and, if you like, <b>photos</b> → <b>Save</b>.</li></ol>
<p>A place you cannot reach? While recording, switch to <b>Tap on map</b> and tap the corners on the map.</p>
<h3>3. To measure well</h3>
<ul><li>Check the GPS at the top right: <b>±5 m</b> or less (green) is good.</li>
<li>Marked the wrong place? <b>Undo</b> removes the last point.</li></ul>
<h3>4. Without signal</h3>
<ul><li>Records and photos stay on the phone and upload by themselves when there is signal — with the app open.</li>
<li>Without signal the satellite image does not appear. The <b>simple map</b> shows the roads, rivers and houses of the saved map.</li></ul>
<h3>5. Sharing</h3>
<ul><li>In a record: <b>Share</b> (text + photos to WhatsApp), <b>Google Maps</b> or <b>KML</b> (Google Earth).</li>
<li>Menu → <b>Export</b>: Google Earth, Excel, or everything in a ZIP with photos.</li>
<li>The app updates itself.</li></ul>`,
  ja: `
<h2>使い方</h2>
<h3>1. 現場に行く前に(電波のある所で)</h3>
<ol><li>電波のある所で一度アプリを開き、Google でログインします。メニューに「<b>圏外で使う準備ができています</b>」と出れば OK。</li>
<li>Chrome のメニュー ⋮ →「<b>ホーム画面に追加</b>」。</li>
<li>地図を作業する場所へ動かし、右の地図ボタン →「<b>この辺りを保存</b>」(家まで・10 km 四方)か「<b>広い範囲を保存</b>」(半径 100 km)。場所ごとにくり返します。Malema〜Ribáue 周辺では衛星写真も保存されます。</li></ol>
<h3>2. 圃場を記録する</h3>
<ol><li>「<b>新しく記録</b>」→「<b>区画</b>」。すぐに記録が始まります。</li>
<li>縁を歩き、角に来たら「<b>ここを角に</b>」をタップ。その場の位置がすぐ入ります。ふつうは 4〜10 点で足ります。</li>
<li>最初の角に戻る必要はありません。区画は自動で閉じます。</li>
<li>「<b>終了</b>」→ 名前、必要なら<b>写真</b> →「<b>保存</b>」。</li></ol>
<p>立ち入れない場所は、記録の途中で「<b>地図をタップ</b>」に切り替えて、地図上の角をタップします。</p>
<h3>3. 正確に測るには</h3>
<ul><li>右上の GPS を見ます。<b>±5 m</b> 以下(緑)なら良好です。</li>
<li>打ち間違えたら「<b>1つ戻す</b>」で最後の点を消せます。</li></ul>
<h3>4. 圏外のとき</h3>
<ul><li>記録と写真は端末に保存され、電波が戻ったときにアプリを開いていれば自動で送られます。</li>
<li>圏外では衛星写真は出ません。<b>簡易地図</b>に、保存しておいた道・川・建物が出ます。</li></ul>
<h3>5. 共有</h3>
<ul><li>記録を開いて「<b>共有</b>」(文章と写真を WhatsApp へ)、「<b>Google マップ</b>」、「<b>KML</b>」(Google Earth 用)。</li>
<li>メニュー →「<b>書き出し</b>」:Google Earth 用、Excel 用、写真も入った ZIP。</li>
<li>アプリは自動で更新されます。</li></ul>`
};


let lang = 'pt';

function pick(l) { return LANGS.includes(l) ? l : null; }

export function initLang(saved) {
  const nav = (navigator.language || '').toLowerCase();
  lang = pick(saved) || (nav.startsWith('ja') ? 'ja' : nav.startsWith('en') ? 'en' : 'pt');
  document.documentElement.lang = lang;
}

export function getLang() { return lang; }

export function setLang(l) {
  lang = pick(l) || 'pt';
  document.documentElement.lang = lang;
}

/** 日付・数値の書式に使うロケール。 */
export function locale() { return lang === 'ja' ? 'ja-JP' : lang === 'en' ? 'en-GB' : 'pt-PT'; }

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

/** 分類の表示名(どの言語でも)または key から key を返す。読み込み用。見つからなければ ''。 */
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

export const _DICT = DICT;   // テストで全言語のキーが揃っているか確かめる用
