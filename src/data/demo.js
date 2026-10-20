// Built-in demo library: fictional channels with generated programme guide, shown until a playlist is added.
// Channels have no stream URL, so the player shows a moving placeholder picture instead of video.

const CATS = [['sk', 'Slovenské'], ['cz', 'České'], ['news', 'Správy'], ['sport', 'Šport'], ['film', 'Filmy a seriály'], ['kids', 'Deti'], ['doc', 'Dokumenty'], ['music', 'Hudba'], ['life', 'Životný štýl']];
const CAT_META = { sk: ['#2F6BFF', 'txt:SK'], cz: ['#E5394B', 'txt:CZ'], news: ['#F59E0B', 'news'], sport: ['#16A34A', 'ball'], film: ['#8B5CF6', 'film'], kids: ['#EC4899', 'kids'], doc: ['#0EA5A4', 'globe'], music: ['#F43F5E', 'note'], life: ['#F97316', 'cup'] };
const RAW = [
  ['sk', 'Tatra 1', '#3D7BFF', '#FF4D6D', ['num', '1', 'TATRA']],
  ['sk', 'Tatra 2', '#1FB57F', '#3D7BFF', ['num', '2', 'TATRA']],
  ['sk', 'Dunaj', '#14A6E8', '#FFC145', ['word', 'dunaj']],
  ['sk', 'Morava+', '#E8455A', '#FFC145', ['plus', 'MORAVA']],
  ['sk', 'Orava', '#F28C28', '#7B61FF', ['circle', 'O', 'ORAVA']],
  ['sk', 'Kriváň', '#8E6CFF', '#2EC4B6', ['stack', 'KRI', 'VÁŇ']],
  ['sk', 'Poprad', '#06B6D4', '#F59E0B', ['word', 'poprad']],
  ['cz', 'Vltava 1', '#2563EB', '#F43F5E', ['num', '1', 'VLTAVA']],
  ['cz', 'Vltava 2', '#0EA5E9', '#22C55E', ['num', '2', 'VLTAVA']],
  ['cz', 'Praha+', '#E11D48', '#FBBF24', ['plus', 'PRAHA']],
  ['cz', 'Brno TV', '#F97316', '#FDE68A', ['circle', 'B', 'BRNO TV']],
  ['cz', 'Šumava', '#22A35A', '#A7F3D0', ['serif', 'Šumava']],
  ['cz', 'Krkonoše', '#7C3AED', '#C4B5FD', ['stack', 'KRKO', 'NOŠE']],
  ['cz', 'Pohoda', '#EC4899', '#FBCFE8', ['word', 'pohoda']],
  ['news', 'Info 24', '#E0313F', '#FFD166', ['pill', 'INFO', '24']],
  ['news', 'Svet správ', '#2F7BF2', '#9ECBFF', ['stack', 'SVET', 'SPRÁV']],
  ['news', 'Biznis', '#12A97F', '#9BE8C9', ['word', 'biznis']],
  ['news', 'Parlament', '#8492A6', '#CBD5E1', ['stack', 'PARLA', 'MENT']],
  ['sport', 'Šport Live 1', '#FF5A1F', '#FFD23F', ['sport', 'ŠPORT', 'LIVE 1']],
  ['sport', 'Šport Live 2', '#FF5A1F', '#4CC9F0', ['sport', 'ŠPORT', 'LIVE 2']],
  ['sport', 'Šport Live 3', '#FF5A1F', '#C084FC', ['sport', 'ŠPORT', 'LIVE 3']],
  ['sport', 'Gól', '#19C173', '#B8F5D3', ['sport', '', 'GÓL']],
  ['sport', 'Ľad TV', '#4CC9F0', '#E0F7FF', ['circle', 'Ľ', 'ĽAD TV']],
  ['sport', 'Motor', '#E63946', '#F4A261', ['sport', '', 'MOTOR']],
  ['sport', 'Tenis+', '#A3E635', '#4ADE80', ['plus', 'TENIS']],
  ['film', 'Kino Max', '#F4B400', '#E53935', ['stack', 'KINO', 'MAX']],
  ['film', 'Noir', '#D6D6DE', '#B3263A', ['serif', 'Noir']],
  ['film', 'Premiéra', '#D84BF0', '#FFD54F', ['word', 'premiéra']],
  ['film', 'Smiech', '#FFCA3A', '#FF595E', ['plus', 'SMIECH']],
  ['film', 'Seriál+', '#38BDF8', '#F472B6', ['plus', 'SERIÁL']],
  ['film', 'Klasik', '#E5D3B3', '#B45309', ['serif', 'Klasik']],
  ['film', 'Akcia', '#EF4444', '#FACC15', ['sport', '', 'AKCIA']],
  ['kids', 'Junior', '#FF7AB6', '#7BDFF2', ['word', 'junior']],
  ['kids', 'Rozprávka', '#A66CFF', '#F15BB5', ['serif', 'Rozprávka']],
  ['kids', 'Mráčik', '#4EA8DE', '#FFFFFF', ['circle', 'M', 'MRÁČIK']],
  ['kids', 'Kocky', '#F59E0B', '#22D3EE', ['word', 'kocky']],
  ['doc', 'Príroda', '#52B788', '#D8F3DC', ['word', 'príroda']],
  ['doc', 'História', '#C98B58', '#F3E9DC', ['serif', 'História']],
  ['doc', 'Cestovateľ', '#00B4D8', '#FFB703', ['stack', 'CESTO', 'VATEĽ']],
  ['doc', 'Veda+', '#7B61FF', '#00E0C6', ['plus', 'VEDA']],
  ['music', 'Hity', '#FF2E7E', '#FFBE0B', ['pill', 'HITY', '']],
  ['music', 'Retro', '#FB6A1E', '#9D5CFF', ['word', 'retro']],
  ['music', 'Jazz Klub', '#E9C46A', '#2A9D8F', ['serif', 'Jazz Klub']],
  ['music', 'Rádio TV', '#14B8A6', '#F0ABFC', ['pill', 'RÁDIO', 'TV']],
  ['life', 'Kuchyňa', '#F77F00', '#FCBF49', ['word', 'kuchyňa']],
  ['life', 'Domov', '#2A9D8F', '#E9C46A', ['circle', 'D', 'DOMOV']],
];
const POOL = {
  sk: [['Hlavné správy', 'Spravodajstvo', 'Najdôležitejšie udalosti dňa zo Slovenska a zo sveta.'],
    ['Ulica pod hradom', 'Seriál', 'Susedia z jednej bratislavskej ulice riešia lásky, dlhy aj staré krivdy.'],
    ['Večerný kvíz', 'Zábava', 'Traja súťažiaci, desať otázok a jeden kufor plný peňazí.'],
    ['Kriminálka Podunajsko', 'Krimi seriál', 'Major Hudecová vyšetruje zmiznutie rybára pri Gabčíkove.'],
    ['Chalupári dnes', 'Komédia', 'Mestská rodina zdedí chalupu na Orave a zistí, že vidiek má vlastné pravidlá.'],
    ['Hviezdy na ľade', 'Zábavná show', 'Známe tváre sa učia krasokorčuľovať. Dnes je na programe semifinále.'],
    ['Reportéri', 'Publicistika', 'Reportáž o tom, kam sa strácajú peniaze na opravu ciest.'],
    ['Doktorka z kúpeľov', 'Seriál', 'Mladá lekárka nastupuje do kúpeľov a hneď v prvý deň rieši nečakaného pacienta.'],
    ['Počasie', 'Spravodajstvo', 'Predpoveď počasia na najbližšie dni.'],
    ['Vtipnejší vyhráva', 'Zábava', 'Komici improvizujú na témy od divákov.']],
  cz: [['Události', 'Zpravodajství', 'Hlavní zprávy dne z domova i ze světa.'],
    ['Ulice u řeky', 'Seriál', 'Sousedé z pražského nábřeží řeší lásky, dluhy i staré křivdy.'],
    ['Hospoda U Lípy', 'Komedie', 'Štamgasti, nový majitel a jedno nečekané dědictví.'],
    ['Kriminálka Vysočina', 'Krimi seriál', 'Kapitánka Novotná vyšetřuje zmizení hajného.'],
    ['Taneční s hvězdami', 'Zábavná show', 'Známé tváře na parketu. Dnes čtvrtfinále.'],
    ['Počasí', 'Zpravodajství', 'Předpověď počasí na nejbližší dny.'],
    ['Chalupa na Šumavě', 'Rodinný seriál', 'Městská rodina se stěhuje na venkov a zjišťuje, že to není idyla.'],
    ['Kufr plný otázek', 'Soutěž', 'Tři soutěžící, deset otázek a jeden kufr peněz.'],
    ['Reportéři v terénu', 'Publicistika', 'Reportáž o tom, kam mizí peníze na opravy silnic.']],
  news: [['Správy', 'Spravodajstvo', 'Prehľad udalostí doma a vo svete.'],
    ['Téma dňa', 'Diskusia', 'Hostia v štúdiu rozoberajú najdôležitejšiu tému dňa.'],
    ['Ekonomika', 'Spravodajstvo', 'Kurzy, trhy a čo znamenajú pre vašu peňaženku.'],
    ['Svet v skratke', 'Spravodajstvo', 'Zahraničné udalosti za posledných 24 hodín.'],
    ['Rozhovor týždňa', 'Rozhovor', 'Dlhý rozhovor s osobnosťou, o ktorej sa tento týždeň hovorí.'],
    ['Šport v skratke', 'Spravodajstvo', 'Výsledky, góly a prestupy dňa.'],
    ['Počasie', 'Spravodajstvo', 'Predpoveď počasia s radarom zrážok.']],
  sport: [['Hokej: HC Košice – HK Nitra', 'Hokej · extraliga', 'Priamy prenos zápasu základnej časti z Košíc.'],
    ['Futbal: Slovan – Spartak Trnava', 'Futbal · 1. liga', 'Derby s veľkou rivalitou. Priamy prenos z Bratislavy.'],
    ['Tenis: turnaj vo Viedni', 'Tenis', 'Štvrťfinále dvojhry mužov.'],
    ['Formula 1: Veľká cena Mexika', 'Motoršport', 'Kvalifikácia na nedeľňajšie preteky.'],
    ['Štúdio Šport', 'Magazín', 'Rozbor víkendových zápasov s hosťami v štúdiu.'],
    ['Biatlon: Svetový pohár', 'Zimné športy', 'Šprint žien na 7,5 km.'],
    ['Basketbal: NBA', 'Basketbal', 'Záznam nočného zápasu zámorskej ligy.'],
    ['Liga majstrov: zostrih', 'Futbal', 'Všetky góly a najlepšie momenty kola.']],
  film: [['Posledný vlak do Žiliny', 'Dráma · 2019', 'Strojvodca na poslednej jazde pred dôchodkom vezie nečakaného pasažiera.'],
    ['Tiene nad Tatrami', 'Thriller · 2022', 'Horská služba pátra po nezvestnej skupine turistov a od západu sa blíži búrka.'],
    ['Noc v prístave', 'Krimi · 1958', 'Čiernobiela klasika o pašerákoch a policajtovi, ktorý vie príliš veľa.'],
    ['Svadba na tri', 'Komédia · 2021', 'Tri sestry, jeden termín a jediná voľná sála v meste.'],
    ['Hranica', 'Vojnová dráma · 2016', 'Príbeh colníka na rakúskej hranici v auguste 1968.'],
    ['Leto s Klárou', 'Romantický · 2020', 'Dvaja cudzinci si na jedno leto vymenia byty a potom aj životy.'],
    ['Červený sneh', 'Akčný · 2018', 'Bývalý agent sa musí vrátiť do mesta, z ktorého pred rokmi utiekol.']],
  kids: [['Lesní kamaráti', 'Animovaný', 'Jazvec Bohuš hľadá stratený klobúk.'],
    ['Robot Bobo', 'Animovaný', 'Bobo sa učí, ako sa pečie chlieb.'],
    ['Večerníček', 'Rozprávka', 'Krátka rozprávka na dobrú noc.'],
    ['Malí vedci', 'Náučný', 'Prečo je obloha modrá a západ slnka červený?'],
    ['Princezná z Veternej hory', 'Rozprávka', 'Princezná, ktorá nechce čakať na princa.'],
    ['Hasiči z Kvetinkova', 'Animovaný', 'Malí hasiči zachraňujú mačku zo strechy radnice.']],
  doc: [['Divoké Karpaty', 'Príroda', 'Rok v živote rysa ostrovida.'],
    ['Tajomstvá oceánov', 'Príroda', 'Hlbokomorské živočíchy, ktoré svietia v tme.'],
    ['Stavitelia katedrál', 'História', 'Ako stredovekí majstri postavili Dóm svätej Alžbety v Košiciach.'],
    ['Hrady Slovenska', 'História', 'Trenčiansky hrad a legenda o studni lásky.'],
    ['Na bicykli okolo sveta', 'Cestopis', 'Dvaja kamaráti, 18 000 kilometrov a jeden pokazený nosič.'],
    ['Vesmír zblízka', 'Veda', 'Čo nám prezradil teleskop o prvých galaxiách.'],
    ['Zázraky techniky', 'Veda', 'Ako sa stavia most cez Dunaj.']],
  music: [['Hitparáda týždňa', 'Hudba', 'Dvadsať najhranejších skladieb týždňa.'],
    ['Retro 90s', 'Hudba', 'Klipy, pri ktorých sa nedá sedieť.'],
    ['Jazzový večer v Redute', 'Koncert', 'Záznam koncertu z bratislavskej Reduty.'],
    ['Nonstop hity', 'Hudba', 'Hudobné klipy bez prestávky.'],
    ['Akustické večery', 'Koncert', 'Známe kapely v komornej akustickej podobe.']],
  life: [['Varíme s Petrom', 'Varenie', 'Bryndzové halušky trochu inak a dezert z tekvice.'],
    ['Záhrada na jeseň', 'Záhrada', 'Čo strihať, čo sadiť a čo nechať tak až do jari.'],
    ['Bývanie snov', 'Bývanie', 'Rekonštrukcia panelákového bytu za šesť týždňov.'],
    ['Pečieme doma', 'Varenie', 'Kváskový chlieb pre začiatočníkov.'],
    ['Chuť Talianska', 'Cestovanie a jedlo', 'Kulinárska cesta po Sicílii.']],
};
const DUR = { sk: [25, 90], cz: [25, 90], news: [15, 45], sport: [60, 150], film: [85, 140], kids: [10, 30], doc: [30, 60], music: [45, 120], life: [25, 60] };

const MIN = 60000;
function rng(seed) {
  return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
const SEC_ORDER = ['sk', 'cz', 'film', 'sport', 'news', 'kids', 'doc', 'music', 'life'];
const FAV = ['Tatra 1', 'Šport Live 1', 'Kino Max', 'Vltava 1', 'Info 24', 'Príroda', 'Noir'];
const RECENT = ['Tatra 1', 'Šport Live 1', 'Vltava 1', 'Dunaj', 'Noir', 'Info 24', 'Junior', 'Gól', 'Príroda'];
const QUICK = ['film', 'cz', 'sk', 'sport', 'news', 'kids', 'doc', 'music'];

export function buildDemo() {
  const catName = Object.fromEntries(CATS);
  const channels = RAW.map((r, i) => ({ id: 'c' + (i + 1), cat: r[0], group: catName[r[0]], name: r[1], c1: r[2], c2: r[3], logo: r[4], url: '', catchup: { type: 'demo', days: 2 } }));
  const day0 = new Date(); day0.setHours(0, 0, 0, 0);
  const D0 = day0.getTime();
  const from = D0 - 30 * 60 * MIN, to = D0 + 54 * 60 * MIN;
  const epg = {};
  channels.forEach((ch, i) => {
    const r = rng(i * 7919 + Math.floor(D0 / 86400000));
    const pool = POOL[ch.cat], [a, b] = DUR[ch.cat];
    let t = from - Math.floor(r() * 12) * 5 * MIN, last = -1;
    const list = [];
    while (t < to) {
      let k; do { k = Math.floor(r() * pool.length); } while (k === last);
      last = k;
      const d = (a + Math.floor(r() * ((b - a) / 5 + 1)) * 5) * MIN;
      list.push({ start: t, end: t + d, title: pool[k][0], genre: pool[k][1], desc: pool[k][2] });
      t += d;
    }
    epg[ch.id] = list;
  });
  const idOf = n => channels.find(c => c.name === n).id;
  return {
    channels,
    groups: SEC_ORDER.map(k => ({ id: k, name: catName[k], color: CAT_META[k][0], icon: CAT_META[k][1] })),
    epg,
    defaults: { fav: FAV.map(idOf), recent: RECENT.map(idOf), quick: QUICK.slice() },
  };
}
