// 發音陷阱：台灣人最容易念錯、或聽不出差別的英文音。
// 每一組是「只差一個音、意思完全不同」的兩個字：[字A, 中文A, 字B, 中文B]

export const TRAP_GROUPS = [
  {
    id: 'th', name: 'th', title: 'th ↔ s／t',
    tip: 'th：舌尖輕輕夾在上下牙齒中間，往外吹氣。不咬舌就會變成 s 或 t。',
    pairs: [
      ['think', '想', 'sink', '水槽'],
      ['thank', '感謝', 'sank', '沉沒了'],
      ['thick', '厚的', 'sick', '生病的'],
      ['mouth', '嘴巴', 'mouse', '老鼠'],
      ['three', '三', 'tree', '樹'],
      ['thin', '瘦的', 'tin', '錫罐'],
      ['path', '小路', 'pass', '通過'],
    ],
  },
  {
    id: 'rl', name: 'r／l', title: 'r ↔ l',
    tip: 'r：舌頭往後捲、不碰到任何地方，嘴唇有點嘟。l：舌尖頂在上排牙齒後面。',
    pairs: [
      ['rice', '米飯', 'lice', '蝨子'],
      ['right', '右邊／對的', 'light', '燈'],
      ['road', '道路', 'load', '負載'],
      ['read', '讀', 'lead', '帶領'],
      ['pray', '祈禱', 'play', '玩'],
      ['fry', '油炸', 'fly', '飛'],
      ['grass', '草', 'glass', '玻璃杯'],
      ['correct', '正確的', 'collect', '收集'],
    ],
  },
  {
    id: 'vb', name: 'v／b', title: 'v ↔ b',
    tip: 'v：上排牙齒輕輕咬住下嘴唇，振動發聲。b：兩片嘴唇閉起來再彈開。',
    pairs: [
      ['very', '非常', 'berry', '莓果'],
      ['vote', '投票', 'boat', '船'],
      ['van', '廂型車', 'ban', '禁止'],
      ['vest', '背心', 'best', '最好的'],
      ['curve', '彎道', 'curb', '路邊石'],
    ],
  },
  {
    id: 'long', name: '長短音', title: '長音 ee ↔ 短音 i',
    tip: '長音 ee：嘴角往兩邊拉開、拉長。短音 i：嘴巴放鬆、短短的，比較像「ㄧ」和「ㄝ」中間。',
    pairs: [
      ['sheep', '綿羊', 'ship', '船'],
      ['leave', '離開', 'live', '住'],
      ['seat', '座位', 'sit', '坐'],
      ['feet', '腳（複數）', 'fit', '合身'],
      ['heat', '熱', 'hit', '打'],
      ['eat', '吃', 'it', '它'],
      ['sleep', '睡覺', 'slip', '滑倒'],
    ],
  },
  {
    id: 'end', name: '字尾音', title: '字尾的子音',
    tip: '字尾的 d、g、z 要輕輕念出聲音，前面的母音也會拉長一點；t、k、s 則短而無聲。',
    pairs: [
      ['bed', '床', 'bet', '打賭'],
      ['bag', '袋子', 'back', '背／後面'],
      ['card', '卡片', 'cart', '推車'],
      ['ride', '騎', 'right', '右邊'],
      ['prize', '獎品', 'price', '價格'],
      ['eyes', '眼睛', 'ice', '冰'],
    ],
  },
  {
    id: 'ae', name: 'a／e', title: 'a (æ) ↔ e',
    tip: 'æ（bad 的 a）：嘴巴張大、嘴角往兩邊拉，像「ㄝ」但嘴巴更開。e：嘴巴開小一點。',
    pairs: [
      ['bad', '壞的', 'bed', '床'],
      ['man', '男人', 'men', '男人們'],
      ['pan', '平底鍋', 'pen', '筆'],
      ['sad', '難過', 'said', '說了'],
      ['had', '有（過去式）', 'head', '頭'],
    ],
  },
  {
    id: 'ng', name: 'n／ng', title: 'n ↔ ng',
    tip: 'n：舌尖頂上排牙齒後面收尾。ng：舌頭後面往上頂，聲音從鼻子出來（像「ㄥ」）。',
    pairs: [
      ['thin', '瘦的', 'thing', '東西'],
      ['win', '贏', 'wing', '翅膀'],
      ['ran', '跑了', 'rang', '響了'],
      ['ban', '禁止', 'bang', '砰一聲'],
    ],
  },
];
