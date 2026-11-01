// Lists every text of the app with its id (a hash of the Slovak original), for translating:
//   node tools/i18n-master.mjs > master.txt        lines: id<TAB>English<TAB>Slovak (templates marked with T)
import { EN, EN_T } from '../src/i18n-en.js';
import { textId } from '../src/i18n-id.js';
for (const [sk, en] of Object.entries(EN)) console.log(`${textId(sk)}\t${en}\t${sk}`);
for (const [sk, en] of Object.entries(EN_T)) console.log(`${textId(sk)}T\t${en}\t${sk}`);
