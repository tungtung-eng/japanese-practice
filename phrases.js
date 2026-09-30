// 會話句子資料：網頁和推播伺服器（worker/）共用這一份。
//
// 日文寫法：[漢字|讀音] 會變成漢字上方的假名注音，例如 [会計|かいけい]。
// 假名那一行由程式自動產生（把漢字換成讀音），不用另外寫。
// 羅馬拼音用平文式（長音寫 ō、ū），助詞「は／へ／を」照發音寫 wa／e／o。
//
// slot 決定這個場景的句子會出現在哪一個時段的推播：
//   morning 早上 09:00　noon 中午 11:30　evening 晚上 20:00

export const SCENES = [
  {
    id: 'greet', icon: '💬', name: '寒暄', slot: 'morning',
    phrases: [
      ['おはようございます', 'ohayō gozaimasu', '早安'],
      ['こんにちは', 'konnichiwa', '你好（白天）'],
      ['こんばんは', 'konbanwa', '晚上好'],
      ['ありがとうございます', 'arigatō gozaimasu', '謝謝'],
      ['すみません', 'sumimasen', '不好意思／請問一下'],
      ['はい、そうです', 'hai, sō desu', '是的，沒錯'],
      ['いいえ、[大丈夫|だいじょうぶ]です', 'iie, daijōbu desu', '不用了，沒關係'],
      ['[日本語|にほんご]が[少|すこ]しだけ[話|はな]せます', 'nihongo ga sukoshi dake hanasemasu', '我只會說一點點日文'],
      ['もう[一度|いちど]お[願|ねが]いします', 'mō ichido onegaishimasu', '麻煩再說一次'],
      ['ゆっくり[話|はな]してください', 'yukkuri hanashite kudasai', '請說慢一點'],
      ['[台湾|たいわん]から[来|き]ました', 'taiwan kara kimashita', '我從台灣來的'],
      ['これは[日本語|にほんご]で[何|なん]と[言|い]いますか？', 'kore wa nihongo de nan to iimasu ka', '這個日文怎麼說？'],
      ['わかりました', 'wakarimashita', '我明白了'],
      ['よろしくお[願|ねが]いします', 'yoroshiku onegaishimasu', '請多指教／麻煩你了'],
      ['さようなら', 'sayōnara', '再見'],
    ],
  },
  {
    id: 'airport', icon: '✈️', name: '機場', slot: 'morning',
    phrases: [
      ['パスポートはこちらです', 'pasupōto wa kochira desu', '這是我的護照'],
      ['[観光|かんこう]です', 'kankō desu', '來觀光的'],
      ['[五日間|いつかかん][滞在|たいざい]します', 'itsukakan taizai shimasu', '我會停留五天'],
      ['[申告|しんこく]するものはありません', 'shinkoku suru mono wa arimasen', '沒有要申報的東西'],
      ['[窓側|まどがわ]の[席|せき]をお[願|ねが]いします', 'madogawa no seki o onegaishimasu', '麻煩給我靠窗的座位'],
      ['[通路側|つうろがわ]の[席|せき]をお[願|ねが]いします', 'tsūrogawa no seki o onegaishimasu', '麻煩給我靠走道的座位'],
      ['[荷物|にもつ]を[預|あず]けたいです', 'nimotsu o azuketai desu', '我想托運行李'],
      ['[搭乗口|とうじょうぐち]はどこですか？', 'tōjōguchi wa doko desu ka', '登機口在哪裡？'],
      ['[荷物|にもつ]が[出|で]てきません', 'nimotsu ga dete kimasen', '我的行李沒有出來'],
      ['[両替所|りょうがえじょ]はどこですか？', 'ryōgaejo wa doko desu ka', '換匯處在哪裡？'],
      ['[市内|しない]へ[行|い]くバスはどこですか？', 'shinai e iku basu wa doko desu ka', '往市區的巴士在哪裡？'],
      ['[空港|くうこう]までどのくらいかかりますか？', 'kūkō made dono kurai kakarimasu ka', '到機場要多久？'],
    ],
  },
  {
    id: 'transport', icon: '🚃', name: '交通', slot: 'morning',
    phrases: [
      ['[駅|えき]はどこですか？', 'eki wa doko desu ka', '車站在哪裡？'],
      ['[新宿|しんじゅく]まで[行|い]きたいです', 'shinjuku made ikitai desu', '我想去新宿'],
      ['この[電車|でんしゃ]は[新宿|しんじゅく]に[行|い]きますか？', 'kono densha wa shinjuku ni ikimasu ka', '這班電車有到新宿嗎？'],
      ['[切符|きっぷ]はどこで[買|か]えますか？', 'kippu wa doko de kaemasu ka', '車票在哪裡買？'],
      ['[何番線|なんばんせん]ですか？', 'nanbansen desu ka', '是第幾月台？'],
      ['どこで[乗|の]り[換|か]えますか？', 'doko de norikaemasu ka', '要在哪裡轉車？'],
      ['[次|つぎ]の[駅|えき]は[何|なん]ですか？', 'tsugi no eki wa nan desu ka', '下一站是哪裡？'],
      ['ここで[降|お]ります', 'koko de orimasu', '我在這裡下車'],
      ['タクシー[乗|の]り[場|ば]はどこですか？', 'takushī noriba wa doko desu ka', '計程車招呼站在哪裡？'],
      ['この[住所|じゅうしょ]までお[願|ねが]いします', 'kono jūsho made onegaishimasu', '麻煩到這個地址'],
      ['[歩|ある]いて[行|い]けますか？', 'aruite ikemasu ka', '走路到得了嗎？'],
      ['[地図|ちず]で[教|おし]えてください', 'chizu de oshiete kudasai', '請在地圖上告訴我'],
      ['[道|みち]に[迷|まよ]いました', 'michi ni mayoimashita', '我迷路了'],
      ['[右|みぎ]ですか、[左|ひだり]ですか？', 'migi desu ka, hidari desu ka', '是右邊還是左邊？'],
    ],
  },
  {
    id: 'food', icon: '🍜', name: '餐廳', slot: 'noon',
    phrases: [
      ['[二人|ふたり]です', 'futari desu', '兩位'],
      ['[予約|よやく]していません', 'yoyaku shite imasen', '我沒有預約'],
      ['メニューをください', 'menyū o kudasai', '請給我菜單'],
      ['[中国語|ちゅうごくご]のメニューはありますか？', 'chūgokugo no menyū wa arimasu ka', '有中文菜單嗎？'],
      ['おすすめは[何|なん]ですか？', 'osusume wa nan desu ka', '有推薦的嗎？'],
      ['これをください', 'kore o kudasai', '我要這個'],
      ['これを[二|ふた]つください', 'kore o futatsu kudasai', '這個給我兩份'],
      ['お[水|みず]をください', 'omizu o kudasai', '請給我水'],
      ['[辛|から]くしないでください', 'karaku shinaide kudasai', '請不要做辣的'],
      ['[牛肉|ぎゅうにく]が[食|た]べられません', 'gyūniku ga taberaremasen', '我不能吃牛肉'],
      ['[取|と]り[皿|ざら]をください', 'torizara o kudasai', '請給我小盤子'],
      ['おいしいです', 'oishii desu', '很好吃'],
      ['お[会計|かいけい]お[願|ねが]いします', 'okaikei onegaishimasu', '麻煩結帳'],
      ['カードで[払|はら]えますか？', 'kādo de haraemasu ka', '可以刷卡嗎？'],
      ['[別々|べつべつ]にお[願|ねが]いします', 'betsubetsu ni onegaishimasu', '麻煩分開結帳'],
      ['ごちそうさまでした', 'gochisōsama deshita', '謝謝招待（吃飽了）'],
    ],
  },
  {
    id: 'shop', icon: '🛍️', name: '購物', slot: 'noon',
    phrases: [
      ['これはいくらですか？', 'kore wa ikura desu ka', '這個多少錢？'],
      ['[見|み]ているだけです', 'mite iru dake desu', '我只是看看'],
      ['[試着|しちゃく]してもいいですか？', 'shichaku shite mo ii desu ka', '可以試穿嗎？'],
      ['もっと[大|おお]きいサイズはありますか？', 'motto ōkii saizu wa arimasu ka', '有大一點的尺寸嗎？'],
      ['もっと[小|ちい]さいサイズはありますか？', 'motto chiisai saizu wa arimasu ka', '有小一點的尺寸嗎？'],
      ['[他|ほか]の[色|いろ]はありますか？', 'hoka no iro wa arimasu ka', '有其他顏色嗎？'],
      ['[在庫|ざいこ]はありますか？', 'zaiko wa arimasu ka', '還有庫存嗎？'],
      ['これにします', 'kore ni shimasu', '我要買這個'],
      ['[少|すこ]し[安|やす]くなりませんか？', 'sukoshi yasuku narimasen ka', '可以便宜一點嗎？'],
      ['[免税|めんぜい]できますか？', 'menzei dekimasu ka', '可以免稅嗎？'],
      ['[現金|げんきん]で[払|はら]います', 'genkin de haraimasu', '我付現金'],
      ['[袋|ふくろ]をください', 'fukuro o kudasai', '請給我袋子'],
      ['プレゼント[用|よう]に[包|つつ]んでください', 'purezento yō ni tsutsunde kudasai', '請幫我包裝成禮物'],
      ['レシートをください', 'reshīto o kudasai', '請給我收據'],
    ],
  },
  {
    id: 'konbini', icon: '🏪', name: '超商', slot: 'noon',
    phrases: [
      ['[温|あたた]めてください', 'atatamete kudasai', '請幫我加熱'],
      ['[温|あたた]めますか？', 'atatamemasu ka', '（店員會問）要加熱嗎？'],
      ['[袋|ふくろ]はご[利用|りよう]ですか？', 'fukuro wa goriyō desu ka', '（店員會問）需要袋子嗎？'],
      ['[袋|ふくろ]はいりません', 'fukuro wa irimasen', '不用袋子'],
      ['このままで[大丈夫|だいじょうぶ]です', 'kono mama de daijōbu desu', '這樣就好（不用包裝）'],
      ['お[箸|はし]をください', 'ohashi o kudasai', '請給我筷子'],
      ['スプーンをください', 'supūn o kudasai', '請給我湯匙'],
      ['ポイントカードはお[持|も]ちですか？', 'pointo kādo wa omochi desu ka', '（店員會問）有集點卡嗎？'],
      ['[持|も]っていません', 'motte imasen', '沒有'],
      ['[交通系|こうつうけい]カードで[払|はら]います', 'kōtsūkei kādo de haraimasu', '用交通卡付款'],
      ['トイレを[借|か]りてもいいですか？', 'toire o karite mo ii desu ka', '可以借用廁所嗎？'],
      ['お[金|かね]をおろしたいです', 'okane o oroshitai desu', '我想領錢'],
      ['[充電器|じゅうでんき]はありますか？', 'jūdenki wa arimasu ka', '有賣充電器嗎？'],
    ],
  },
  {
    id: 'hotel', icon: '🏨', name: '飯店', slot: 'evening',
    phrases: [
      ['チェックインをお[願|ねが]いします', 'chekkuin o onegaishimasu', '麻煩辦理入住'],
      ['[予約|よやく]しています', 'yoyaku shite imasu', '我有預約'],
      ['チェックアウトは[何時|なんじ]ですか？', 'chekkuauto wa nanji desu ka', '幾點退房？'],
      ['[朝食|ちょうしょく]は[何時|なんじ]からですか？', 'chōshoku wa nanji kara desu ka', '早餐幾點開始？'],
      ['[荷物|にもつ]を[預|あず]かってもらえますか？', 'nimotsu o azukatte moraemasu ka', '可以幫我寄放行李嗎？'],
      ['ワイファイのパスワードは[何|なん]ですか？', 'waifai no pasuwādo wa nan desu ka', 'Wi-Fi 密碼是什麼？'],
      ['[部屋|へや]の[鍵|かぎ]をなくしました', 'heya no kagi o nakushimashita', '我把房間鑰匙弄丟了'],
      ['お[湯|ゆ]が[出|で]ません', 'oyu ga demasen', '沒有熱水'],
      ['エアコンが[壊|こわ]れています', 'eakon ga kowarete imasu', '冷氣壞了'],
      ['タオルをもう[一枚|いちまい]ください', 'taoru o mō ichimai kudasai', '請再給我一條毛巾'],
      ['[近|ちか]くにコンビニはありますか？', 'chikaku ni konbini wa arimasu ka', '附近有便利商店嗎？'],
      ['タクシーを[呼|よ]んでもらえますか？', 'takushī o yonde moraemasu ka', '可以幫我叫計程車嗎？'],
      ['もう[一泊|いっぱく]したいです', 'mō ippaku shitai desu', '我想多住一晚'],
    ],
  },
  {
    id: 'sight', icon: '♨️', name: '觀光', slot: 'evening',
    phrases: [
      ['[写真|しゃしん]を[撮|と]ってもらえますか？', 'shashin o totte moraemasu ka', '可以幫我拍照嗎？'],
      ['ここで[写真|しゃしん]を[撮|と]ってもいいですか？', 'koko de shashin o totte mo ii desu ka', '這裡可以拍照嗎？'],
      ['[入場料|にゅうじょうりょう]はいくらですか？', 'nyūjōryō wa ikura desu ka', '門票多少錢？'],
      ['[大人|おとな][二枚|にまい]お[願|ねが]いします', 'otona nimai onegaishimasu', '麻煩兩張成人票'],
      ['[何時|なんじ]まで[開|あ]いていますか？', 'nanji made aite imasu ka', '開到幾點？'],
      ['[入|い]り[口|ぐち]はどこですか？', 'iriguchi wa doko desu ka', '入口在哪裡？'],
      ['トイレはどこですか？', 'toire wa doko desu ka', '廁所在哪裡？'],
      ['コインロッカーはありますか？', 'koin rokkā wa arimasu ka', '有投幣式置物櫃嗎？'],
      ['おすすめの[観光地|かんこうち]はありますか？', 'osusume no kankōchi wa arimasu ka', '有推薦的景點嗎？'],
      ['[温泉|おんせん]は[何時|なんじ]まで[入|はい]れますか？', 'onsen wa nanji made hairemasu ka', '溫泉可以泡到幾點？'],
      ['タオルは[借|か]りられますか？', 'taoru wa kariraremasu ka', '可以借毛巾嗎？'],
      ['[貸切風呂|かしきりぶろ]はありますか？', 'kashikiriburo wa arimasu ka', '有包場湯屋嗎？'],
    ],
  },
  {
    id: 'pharmacy', icon: '💊', name: '藥局', slot: 'evening',
    phrases: [
      ['[薬局|やっきょく]はどこですか？', 'yakkyoku wa doko desu ka', '藥局在哪裡？'],
      ['[頭|あたま]が[痛|いた]いです', 'atama ga itai desu', '我頭痛'],
      ['お[腹|なか]が[痛|いた]いです', 'onaka ga itai desu', '我肚子痛'],
      ['[熱|ねつ]があります', 'netsu ga arimasu', '我發燒了'],
      ['[風邪|かぜ]をひきました', 'kaze o hikimashita', '我感冒了'],
      ['[風邪薬|かぜぐすり]はありますか？', 'kazegusuri wa arimasu ka', '有感冒藥嗎？'],
      ['[下痢|げり]をしています', 'geri o shite imasu', '我在拉肚子'],
      ['[気分|きぶん]が[悪|わる]いです', 'kibun ga warui desu', '我身體不舒服'],
      ['[絆創膏|ばんそうこう]をください', 'bansōkō o kudasai', '請給我 OK 繃'],
      ['[一日|いちにち][何回|なんかい][飲|の]みますか？', 'ichinichi nankai nomimasu ka', '一天吃幾次？'],
      ['[薬|くすり]のアレルギーがあります', 'kusuri no arerugī ga arimasu', '我對藥物過敏'],
      ['[病院|びょういん]に[行|い]きたいです', 'byōin ni ikitai desu', '我想去醫院'],
    ],
  },
  {
    id: 'emergency', icon: '🆘', name: '緊急', slot: 'evening',
    phrases: [
      ['[助|たす]けて！', 'tasukete!', '救命！'],
      ['[救急車|きゅうきゅうしゃ]を[呼|よ]んでください', 'kyūkyūsha o yonde kudasai', '請叫救護車'],
      ['[警察|けいさつ]を[呼|よ]んでください', 'keisatsu o yonde kudasai', '請叫警察'],
      ['けがをしました', 'kega o shimashita', '我受傷了'],
      ['[財布|さいふ]をなくしました', 'saifu o nakushimashita', '我的錢包不見了'],
      ['パスポートをなくしました', 'pasupōto o nakushimashita', '我的護照不見了'],
      ['[携帯|けいたい]を[盗|ぬす]まれました', 'keitai o nusumaremashita', '我的手機被偷了'],
      ['[交番|こうばん]はどこですか？', 'kōban wa doko desu ka', '派出所在哪裡？'],
      ['[中国語|ちゅうごくご]を[話|はな]せる[人|ひと]はいますか？', 'chūgokugo o hanaseru hito wa imasu ka', '有會說中文的人嗎？'],
      ['[台湾|たいわん]の[代表処|だいひょうしょ]に[連絡|れんらく]したいです', 'taiwan no daihyōsho ni renraku shitai desu', '我想聯絡台灣駐日代表處'],
      ['[地震|じしん]です！', 'jishin desu!', '地震了！'],
      ['[避難所|ひなんじょ]はどこですか？', 'hinanjo wa doko desu ka', '避難所在哪裡？'],
    ],
  },
];

// ---------- 由資料推出來的東西（網頁和推播共用，兩邊算出來一定一樣） ----------

const RUBY = /\[([^|\]]+)\|([^\]]+)\]/g;

/** 日文原文（去掉注音標記） */
export const plainText = (jp) => jp.replace(RUBY, '$1');
/** 全假名讀音 */
export const kanaText = (jp) => jp.replace(RUBY, '$2');

/** 每一句都有固定的 id，例如 food-12，收藏與複習紀錄靠它對應 */
export const PHRASES = SCENES.flatMap((s) => s.phrases.map(([jp, romaji, zh], i) => ({
  id: s.id + '-' + (i + 1),
  scene: s.id,
  slot: s.slot,
  jp,
  romaji,
  zh,
  text: plainText(jp),
  kana: kanaText(jp),
})));

export const PHRASE_BY_ID = Object.fromEntries(PHRASES.map((p) => [p.id, p]));

export const SLOTS = {
  morning: { icon: '☀️', name: '早', time: '09:00' },
  noon: { icon: '🍱', name: '中', time: '11:30' },
  evening: { icon: '🌙', name: '晚', time: '20:00' },
};

/** 台灣日期的天數編號（每天台灣時間 00:00 換日） */
export function taiwanDay(ms = Date.now()) {
  return Math.floor((ms + 8 * 3600 * 1000) / 86400000);
}

const gcd = (a, b) => (b ? gcd(b, a % b) : a);

/**
 * 某一天某個時段的句子。
 * 每個時段有自己的句子池，每天往前跳幾格（跳的格數和池子大小互質，
 * 所以一輪下來每一句都會輪到、不會重複），連續兩天也不會是同一個場景的下一句。
 */
export function dailyPhrase(slot, day = taiwanDay()) {
  const pool = PHRASES.filter((p) => p.slot === slot);
  const step = [5, 7, 11, 13, 17].find((s) => gcd(s, pool.length) === 1) || 1;
  return pool[(day * step) % pool.length];
}

export function dailyThree(day = taiwanDay()) {
  return Object.keys(SLOTS).map((slot) => ({ slot, phrase: dailyPhrase(slot, day) }));
}
