import { splitChatGraphemes } from "@tempass/shared";

export type EmojiCategoryId = "smileys" | "gestures" | "hearts" | "reactions" | "objects";

export interface EmojiEntry {
  id: string;
  char: string;
  name: string;
  keywords: string[];
  categoryId: EmojiCategoryId;
  categoryLabel: string;
}

interface EmojiDefinition {
  char: string;
  name: string;
  keywords: string[];
}

interface EmojiCategoryDefinition {
  id: EmojiCategoryId;
  label: string;
  emojis: EmojiDefinition[];
}

export const EMOJI_CATEGORIES: EmojiCategoryDefinition[] = [
  {
    id: "smileys",
    label: "Smileys",
    emojis: [
      { char: "😀", name: "grinning face", keywords: ["grin", "happy", "smile"] },
      { char: "😃", name: "grinning face with big eyes", keywords: ["happy", "smile"] },
      { char: "😄", name: "grinning face with smiling eyes", keywords: ["happy", "smile"] },
      { char: "😁", name: "beaming face", keywords: ["grin", "happy"] },
      { char: "😆", name: "grinning squinting face", keywords: ["laugh", "happy"] },
      { char: "😅", name: "grinning face with sweat", keywords: ["sweat", "relief"] },
      { char: "🤣", name: "rolling on the floor laughing", keywords: ["lol", "rofl"] },
      { char: "😂", name: "face with tears of joy", keywords: ["laugh", "cry"] },
      { char: "🙂", name: "slightly smiling face", keywords: ["smile"] },
      { char: "🙃", name: "upside-down face", keywords: ["silly", "irony"] },
      { char: "🫠", name: "melting face", keywords: ["hot", "embarrassed"] },
      { char: "😉", name: "winking face", keywords: ["wink", "flirt"] },
      { char: "😊", name: "smiling face with smiling eyes", keywords: ["blush", "happy"] },
      { char: "😇", name: "smiling face with halo", keywords: ["angel", "innocent"] },
      { char: "🥰", name: "smiling face with hearts", keywords: ["love", "adore"] },
      { char: "😍", name: "smiling face with heart-eyes", keywords: ["love", "crush"] },
      { char: "🤩", name: "star-struck", keywords: ["wow", "amazed"] },
      { char: "😘", name: "face blowing a kiss", keywords: ["kiss", "love"] },
      { char: "😋", name: "face savoring food", keywords: ["yummy", "tasty"] },
      { char: "😛", name: "face with tongue", keywords: ["tongue", "playful"] },
      { char: "😜", name: "winking face with tongue", keywords: ["tongue", "joke"] },
      { char: "🤪", name: "zany face", keywords: ["crazy", "silly"] },
      { char: "😝", name: "squinting face with tongue", keywords: ["tongue", "silly"] },
      { char: "🤑", name: "money-mouth face", keywords: ["money", "rich"] },
      { char: "🤗", name: "hugging face", keywords: ["hug", "welcome"] },
      { char: "🤭", name: "face with hand over mouth", keywords: ["giggle", "oops"] },
      { char: "🫢", name: "face with open eyes and hand over mouth", keywords: ["gasp"] },
      { char: "🫣", name: "face with peeking eye", keywords: ["peek", "shy"] },
      { char: "🤫", name: "shushing face", keywords: ["quiet", "secret"] },
      { char: "🤔", name: "thinking face", keywords: ["think", "hmm"] },
      { char: "🫡", name: "saluting face", keywords: ["salute", "yes"] },
      { char: "🤐", name: "zipper-mouth face", keywords: ["quiet", "secret"] },
      { char: "🤨", name: "face with raised eyebrow", keywords: ["skeptical", "doubt"] },
      { char: "😐", name: "neutral face", keywords: ["blank", "meh"] },
      { char: "😑", name: "expressionless face", keywords: ["blank", "meh"] },
      { char: "😶", name: "face without mouth", keywords: ["speechless", "silent"] },
      { char: "😏", name: "smirking face", keywords: ["smug", "sly"] },
      { char: "😒", name: "unamused face", keywords: ["annoyed", "meh"] },
      { char: "🙄", name: "face with rolling eyes", keywords: ["eyeroll", "whatever"] },
      { char: "😬", name: "grimacing face", keywords: ["awkward", "oops"] },
      { char: "😮‍💨", name: "face exhaling", keywords: ["sigh", "relief"] },
      { char: "🤥", name: "lying face", keywords: ["lie", "pinocchio"] },
      { char: "😌", name: "relieved face", keywords: ["calm", "peace"] },
      { char: "😔", name: "pensive face", keywords: ["sad", "thoughtful"] },
      { char: "😪", name: "sleepy face", keywords: ["tired", "sleep"] },
      { char: "🤤", name: "drooling face", keywords: ["hungry", "want"] },
      { char: "😴", name: "sleeping face", keywords: ["sleep", "zzz"] },
      { char: "😷", name: "face with medical mask", keywords: ["sick", "mask"] },
      { char: "🤒", name: "face with thermometer", keywords: ["sick", "fever"] },
      { char: "🤕", name: "face with head-bandage", keywords: ["hurt", "injured"] },
      { char: "🤢", name: "nauseated face", keywords: ["sick", "gross"] },
      { char: "🤮", name: "face vomiting", keywords: ["sick", "gross"] },
      { char: "🤧", name: "sneezing face", keywords: ["sick", "sneeze"] },
      { char: "🥵", name: "hot face", keywords: ["hot", "sweat"] },
      { char: "🥶", name: "cold face", keywords: ["cold", "freezing"] },
      { char: "🥴", name: "woozy face", keywords: ["drunk", "dizzy"] },
      { char: "😵", name: "dizzy face", keywords: ["dizzy", "dead"] },
      { char: "🤯", name: "exploding head", keywords: ["mind blown", "shock"] },
      { char: "🤠", name: "cowboy hat face", keywords: ["cowboy", "howdy"] },
      { char: "🥳", name: "partying face", keywords: ["party", "celebrate"] },
      { char: "🥸", name: "disguised face", keywords: ["disguise", "glasses"] },
      { char: "😎", name: "smiling face with sunglasses", keywords: ["cool", "chill"] },
      { char: "🤓", name: "nerd face", keywords: ["nerd", "geek"] },
      { char: "🧐", name: "face with monocle", keywords: ["inspect", "hmm"] },
      { char: "😕", name: "confused face", keywords: ["confused", "unsure"] },
      { char: "😟", name: "worried face", keywords: ["worried", "anxious"] },
      { char: "😮", name: "face with open mouth", keywords: ["surprised", "wow"] },
      { char: "😲", name: "astonished face", keywords: ["shock", "wow"] },
      { char: "😳", name: "flushed face", keywords: ["blush", "embarrassed"] },
      { char: "🥺", name: "pleading face", keywords: ["please", "puppy eyes"] },
      { char: "😨", name: "fearful face", keywords: ["fear", "scared"] },
      { char: "😢", name: "crying face", keywords: ["sad", "tear"] },
      { char: "😭", name: "loudly crying face", keywords: ["sob", "sad"] },
      { char: "😱", name: "face screaming in fear", keywords: ["scream", "shock"] },
      { char: "😖", name: "confounded face", keywords: ["frustrated", "upset"] },
      { char: "😣", name: "persevering face", keywords: ["struggle", "effort"] },
      { char: "😞", name: "disappointed face", keywords: ["sad", "sorry"] },
      { char: "😓", name: "downcast face with sweat", keywords: ["stress", "sweat"] },
      { char: "😩", name: "weary face", keywords: ["tired", "exhausted"] },
      { char: "🥱", name: "yawning face", keywords: ["yawn", "bored"] },
      { char: "😤", name: "face with steam from nose", keywords: ["huff", "proud"] },
      { char: "😡", name: "pouting face", keywords: ["angry", "mad"] },
      { char: "😠", name: "angry face", keywords: ["angry", "mad"] },
      { char: "🤬", name: "face with symbols on mouth", keywords: ["swear", "angry"] },
      { char: "😈", name: "smiling face with horns", keywords: ["devil", "mischief"] },
      { char: "👻", name: "ghost", keywords: ["spooky", "halloween"] },
      { char: "👽", name: "alien", keywords: ["ufo", "space"] },
      { char: "🤖", name: "robot", keywords: ["bot", "machine"] },
      { char: "💀", name: "skull", keywords: ["dead", "death"] },
      { char: "💩", name: "pile of poo", keywords: ["poop", "crap"] },
      { char: "🤡", name: "clown face", keywords: ["clown", "joke"] },
    ],
  },
  {
    id: "gestures",
    label: "Gestures",
    emojis: [
      { char: "👋", name: "waving hand", keywords: ["wave", "hello", "bye"] },
      { char: "🤚", name: "raised back of hand", keywords: ["hand", "stop"] },
      { char: "🖐️", name: "hand with fingers splayed", keywords: ["hand", "five"] },
      { char: "✋", name: "raised hand", keywords: ["hand", "stop", "high five"] },
      { char: "🖖", name: "vulcan salute", keywords: ["spock", "star trek"] },
      { char: "🫱", name: "rightwards hand", keywords: ["hand", "offer"] },
      { char: "🫲", name: "leftwards hand", keywords: ["hand", "offer"] },
      { char: "🫳", name: "palm down hand", keywords: ["hand", "drop"] },
      { char: "🫴", name: "palm up hand", keywords: ["hand", "offer"] },
      { char: "👌", name: "ok hand", keywords: ["ok", "perfect"] },
      { char: "🤌", name: "pinched fingers", keywords: ["chef", "kiss"] },
      { char: "🤏", name: "pinching hand", keywords: ["small", "tiny"] },
      { char: "✌️", name: "victory hand", keywords: ["peace", "two"] },
      { char: "🤞", name: "crossed fingers", keywords: ["luck", "hope"] },
      { char: "🫰", name: "hand with index finger and thumb crossed", keywords: ["heart", "money"] },
      { char: "🤟", name: "love-you gesture", keywords: ["love", "rock"] },
      { char: "🤘", name: "sign of the horns", keywords: ["rock", "metal"] },
      { char: "🤙", name: "call me hand", keywords: ["call", "phone"] },
      { char: "👈", name: "backhand index pointing left", keywords: ["point", "left"] },
      { char: "👉", name: "backhand index pointing right", keywords: ["point", "right"] },
      { char: "👆", name: "backhand index pointing up", keywords: ["point", "up"] },
      { char: "👇", name: "backhand index pointing down", keywords: ["point", "down"] },
      { char: "☝️", name: "index pointing up", keywords: ["point", "one"] },
      { char: "🫵", name: "index pointing at the viewer", keywords: ["point", "you"] },
      { char: "👍", name: "thumbs up", keywords: ["like", "yes", "approve"] },
      { char: "👎", name: "thumbs down", keywords: ["dislike", "no"] },
      { char: "👊", name: "oncoming fist", keywords: ["fist", "bump"] },
      { char: "✊", name: "raised fist", keywords: ["fist", "power"] },
      { char: "🤛", name: "left-facing fist", keywords: ["fist", "bump"] },
      { char: "🤜", name: "right-facing fist", keywords: ["fist", "bump"] },
      { char: "👏", name: "clapping hands", keywords: ["clap", "applause"] },
      { char: "🙌", name: "raising hands", keywords: ["celebrate", "hooray"] },
      { char: "🫶", name: "heart hands", keywords: ["love", "heart"] },
      { char: "👐", name: "open hands", keywords: ["hands", "open"] },
      { char: "🤲", name: "palms up together", keywords: ["pray", "give"] },
      { char: "🤝", name: "handshake", keywords: ["deal", "agreement"] },
      { char: "🙏", name: "folded hands", keywords: ["please", "thanks", "pray"] },
      { char: "✍️", name: "writing hand", keywords: ["write", "note"] },
      { char: "💅", name: "nail polish", keywords: ["nails", "sassy"] },
      { char: "🤳", name: "selfie", keywords: ["selfie", "phone"] },
      { char: "💪", name: "flexed biceps", keywords: ["strong", "muscle"] },
      { char: "🦾", name: "mechanical arm", keywords: ["robot", "strong"] },
      { char: "🦵", name: "leg", keywords: ["leg", "kick"] },
      { char: "🦶", name: "foot", keywords: ["foot", "kick"] },
      { char: "👂", name: "ear", keywords: ["ear", "listen"] },
      { char: "👀", name: "eyes", keywords: ["look", "watch"] },
      { char: "🧠", name: "brain", keywords: ["brain", "smart"] },
      { char: "🫀", name: "anatomical heart", keywords: ["heart", "organ"] },
      { char: "🦷", name: "tooth", keywords: ["tooth", "dental"] },
    ],
  },
  {
    id: "hearts",
    label: "Hearts",
    emojis: [
      { char: "❤️", name: "red heart", keywords: ["love", "heart"] },
      { char: "🧡", name: "orange heart", keywords: ["love", "heart"] },
      { char: "💛", name: "yellow heart", keywords: ["love", "friend"] },
      { char: "💚", name: "green heart", keywords: ["love", "heart"] },
      { char: "💙", name: "blue heart", keywords: ["love", "heart"] },
      { char: "💜", name: "purple heart", keywords: ["love", "heart"] },
      { char: "🖤", name: "black heart", keywords: ["love", "dark"] },
      { char: "🤍", name: "white heart", keywords: ["love", "pure"] },
      { char: "🤎", name: "brown heart", keywords: ["love", "heart"] },
      { char: "💔", name: "broken heart", keywords: ["heartbreak", "sad"] },
      { char: "❣️", name: "heart exclamation", keywords: ["love", "heart"] },
      { char: "💕", name: "two hearts", keywords: ["love", "hearts"] },
      { char: "💞", name: "revolving hearts", keywords: ["love", "hearts"] },
      { char: "💓", name: "beating heart", keywords: ["love", "pulse"] },
      { char: "💗", name: "growing heart", keywords: ["love", "heart"] },
      { char: "💖", name: "sparkling heart", keywords: ["love", "sparkle"] },
      { char: "💘", name: "heart with arrow", keywords: ["cupid", "love"] },
      { char: "💝", name: "heart with ribbon", keywords: ["gift", "love"] },
      { char: "💟", name: "heart decoration", keywords: ["love", "heart"] },
      { char: "♥️", name: "heart suit", keywords: ["cards", "love"] },
      { char: "💌", name: "love letter", keywords: ["letter", "love"] },
      { char: "💋", name: "kiss mark", keywords: ["kiss", "lips"] },
      { char: "🫦", name: "biting lip", keywords: ["flirt", "nervous"] },
      { char: "🫂", name: "people hugging", keywords: ["hug", "comfort"] },
      { char: "💑", name: "couple with heart", keywords: ["couple", "love"] },
      { char: "💏", name: "kiss", keywords: ["couple", "kiss"] },
      { char: "🧑‍🤝‍🧑", name: "people holding hands", keywords: ["couple", "friends"] },
      { char: "❤️‍🔥", name: "heart on fire", keywords: ["passion", "love"] },
      { char: "❤️‍🩹", name: "mending heart", keywords: ["healing", "love"] },
      { char: "💒", name: "wedding", keywords: ["wedding", "marriage"] },
    ],
  },
  {
    id: "reactions",
    label: "Reactions",
    emojis: [
      { char: "💯", name: "hundred points", keywords: ["perfect", "100"] },
      { char: "🔥", name: "fire", keywords: ["hot", "lit"] },
      { char: "✨", name: "sparkles", keywords: ["sparkle", "magic"] },
      { char: "⚡", name: "high voltage", keywords: ["zap", "electric"] },
      { char: "💥", name: "collision", keywords: ["boom", "explosion"] },
      { char: "🎉", name: "party popper", keywords: ["party", "celebrate"] },
      { char: "🎊", name: "confetti ball", keywords: ["party", "celebrate"] },
      { char: "🏆", name: "trophy", keywords: ["win", "champion"] },
      { char: "🥇", name: "first place medal", keywords: ["gold", "win"] },
      { char: "🥈", name: "second place medal", keywords: ["silver", "second"] },
      { char: "🥉", name: "third place medal", keywords: ["bronze", "third"] },
      { char: "🎯", name: "bullseye", keywords: ["target", "goal"] },
      { char: "✅", name: "check mark button", keywords: ["yes", "done"] },
      { char: "❌", name: "cross mark", keywords: ["no", "wrong"] },
      { char: "⚠️", name: "warning", keywords: ["warn", "caution"] },
      { char: "❓", name: "question mark", keywords: ["question", "ask"] },
      { char: "❗", name: "exclamation mark", keywords: ["exclaim", "important"] },
      { char: "💤", name: "zzz", keywords: ["sleep", "tired"] },
      { char: "💢", name: "anger symbol", keywords: ["angry", "annoyed"] },
      { char: "💬", name: "speech balloon", keywords: ["talk", "comment"] },
      { char: "💭", name: "thought balloon", keywords: ["think", "idea"] },
      { char: "🗯️", name: "right anger bubble", keywords: ["angry", "shout"] },
      { char: "🏅", name: "sports medal", keywords: ["medal", "win"] },
      { char: "🎖️", name: "military medal", keywords: ["medal", "honor"] },
      { char: "🎗️", name: "reminder ribbon", keywords: ["ribbon", "awareness"] },
      { char: "🚀", name: "rocket", keywords: ["launch", "fast"] },
      { char: "🎈", name: "balloon", keywords: ["party", "birthday"] },
      { char: "🎁", name: "wrapped gift", keywords: ["gift", "present"] },
      { char: "👑", name: "crown", keywords: ["king", "queen", "best"] },
      { char: "💎", name: "gem stone", keywords: ["diamond", "valuable"] },
      { char: "🪙", name: "coin", keywords: ["money", "gold"] },
      { char: "🧿", name: "nazar amulet", keywords: ["luck", "protection"] },
      { char: "🔮", name: "crystal ball", keywords: ["future", "magic"] },
      { char: "🪄", name: "magic wand", keywords: ["magic", "spell"] },
      { char: "🎴", name: "flower playing cards", keywords: ["cards", "game"] },
      { char: "🎰", name: "slot machine", keywords: ["luck", "casino"] },
      { char: "🎲", name: "game die", keywords: ["dice", "random"] },
    ],
  },
  {
    id: "objects",
    label: "Objects",
    emojis: [
      { char: "⌚", name: "watch", keywords: ["watch", "time"] },
      { char: "📱", name: "mobile phone", keywords: ["phone", "mobile"] },
      { char: "💻", name: "laptop", keywords: ["laptop", "computer"] },
      { char: "⌨️", name: "keyboard", keywords: ["keyboard", "typing"] },
      { char: "🖥️", name: "desktop computer", keywords: ["computer", "desktop"] },
      { char: "🖨️", name: "printer", keywords: ["printer", "paper"] },
      { char: "🖱️", name: "computer mouse", keywords: ["mouse", "click"] },
      { char: "💾", name: "floppy disk", keywords: ["save", "disk"] },
      { char: "💿", name: "optical disk", keywords: ["cd", "disk"] },
      { char: "📀", name: "dvd", keywords: ["dvd", "disk"] },
      { char: "🎮", name: "video game", keywords: ["game", "controller"] },
      { char: "🕹️", name: "joystick", keywords: ["game", "arcade"] },
      { char: "🧩", name: "puzzle piece", keywords: ["puzzle", "piece"] },
      { char: "🎧", name: "headphone", keywords: ["headphones", "music"] },
      { char: "🎤", name: "microphone", keywords: ["microphone", "sing"] },
      { char: "🎸", name: "guitar", keywords: ["guitar", "music"] },
      { char: "🎹", name: "musical keyboard", keywords: ["piano", "music"] },
      { char: "🥁", name: "drum", keywords: ["drum", "music"] },
      { char: "🎺", name: "trumpet", keywords: ["trumpet", "music"] },
      { char: "🎬", name: "clapper board", keywords: ["movie", "action"] },
      { char: "📷", name: "camera", keywords: ["camera", "photo"] },
      { char: "📸", name: "camera with flash", keywords: ["photo", "flash"] },
      { char: "📹", name: "video camera", keywords: ["video", "record"] },
      { char: "📺", name: "television", keywords: ["tv", "watch"] },
      { char: "📻", name: "radio", keywords: ["radio", "music"] },
      { char: "⏰", name: "alarm clock", keywords: ["clock", "alarm"] },
      { char: "⏱️", name: "stopwatch", keywords: ["timer", "time"] },
      { char: "⏳", name: "hourglass", keywords: ["time", "wait"] },
      { char: "🔋", name: "battery", keywords: ["battery", "power"] },
      { char: "🔌", name: "electric plug", keywords: ["plug", "power"] },
      { char: "💡", name: "light bulb", keywords: ["idea", "light"] },
      { char: "🔦", name: "flashlight", keywords: ["light", "torch"] },
      { char: "🕯️", name: "candle", keywords: ["candle", "light"] },
      { char: "📚", name: "books", keywords: ["books", "read"] },
      { char: "📖", name: "open book", keywords: ["book", "read"] },
      { char: "📝", name: "memo", keywords: ["note", "write"] },
      { char: "✏️", name: "pencil", keywords: ["pencil", "write"] },
      { char: "🖊️", name: "pen", keywords: ["pen", "write"] },
      { char: "📌", name: "pushpin", keywords: ["pin", "important"] },
      { char: "📎", name: "paperclip", keywords: ["clip", "attach"] },
      { char: "✂️", name: "scissors", keywords: ["cut", "scissors"] },
      { char: "📏", name: "straight ruler", keywords: ["ruler", "measure"] },
      { char: "🔒", name: "locked", keywords: ["lock", "secure"] },
      { char: "🔓", name: "unlocked", keywords: ["unlock", "open"] },
      { char: "🔑", name: "key", keywords: ["key", "unlock"] },
      { char: "🔨", name: "hammer", keywords: ["hammer", "tool"] },
      { char: "🛠️", name: "hammer and wrench", keywords: ["tools", "fix"] },
      { char: "⚙️", name: "gear", keywords: ["settings", "gear"] },
      { char: "🧲", name: "magnet", keywords: ["magnet", "attract"] },
      { char: "🧪", name: "test tube", keywords: ["science", "lab"] },
      { char: "🔬", name: "microscope", keywords: ["science", "lab"] },
      { char: "🔭", name: "telescope", keywords: ["space", "stars"] },
      { char: "💊", name: "pill", keywords: ["medicine", "pill"] },
      { char: "🩹", name: "adhesive bandage", keywords: ["bandage", "hurt"] },
      { char: "🧬", name: "dna", keywords: ["dna", "science"] },
      { char: "🌍", name: "globe", keywords: ["earth", "world"] },
      { char: "🌙", name: "crescent moon", keywords: ["moon", "night"] },
      { char: "☀️", name: "sun", keywords: ["sun", "day"] },
      { char: "⛅", name: "sun behind cloud", keywords: ["cloud", "weather"] },
      { char: "🌈", name: "rainbow", keywords: ["rainbow", "pride"] },
      { char: "❄️", name: "snowflake", keywords: ["snow", "winter"] },
      { char: "🌊", name: "water wave", keywords: ["wave", "ocean"] },
      { char: "🌋", name: "volcano", keywords: ["volcano", "eruption"] },
      { char: "🌲", name: "evergreen tree", keywords: ["tree", "forest"] },
      { char: "🌵", name: "cactus", keywords: ["cactus", "desert"] },
      { char: "🌻", name: "sunflower", keywords: ["flower", "sun"] },
      { char: "🍀", name: "four leaf clover", keywords: ["luck", "clover"] },
      { char: "🍕", name: "pizza", keywords: ["pizza", "food"] },
      { char: "🍔", name: "hamburger", keywords: ["burger", "food"] },
      { char: "🍟", name: "french fries", keywords: ["fries", "food"] },
      { char: "🍩", name: "doughnut", keywords: ["donut", "sweet"] },
      { char: "🍪", name: "cookie", keywords: ["cookie", "sweet"] },
      { char: "🎂", name: "birthday cake", keywords: ["cake", "birthday"] },
      { char: "☕", name: "hot beverage", keywords: ["coffee", "tea"] },
      { char: "🍺", name: "beer mug", keywords: ["beer", "drink"] },
      { char: "🍷", name: "wine glass", keywords: ["wine", "drink"] },
      { char: "🍿", name: "popcorn", keywords: ["popcorn", "movie"] },
      { char: "🍎", name: "red apple", keywords: ["apple", "fruit"] },
      { char: "🍌", name: "banana", keywords: ["banana", "fruit"] },
      { char: "🍓", name: "strawberry", keywords: ["strawberry", "fruit"] },
      { char: "🍫", name: "chocolate bar", keywords: ["chocolate", "sweet"] },
      { char: "🏀", name: "basketball", keywords: ["basketball", "sport"] },
      { char: "⚽", name: "soccer ball", keywords: ["soccer", "football"] },
      { char: "🎾", name: "tennis", keywords: ["tennis", "sport"] },
      { char: "🏈", name: "american football", keywords: ["football", "sport"] },
      { char: "🎳", name: "bowling", keywords: ["bowling", "sport"] },
      { char: "🏓", name: "ping pong", keywords: ["ping pong", "sport"] },
      { char: "🚗", name: "automobile", keywords: ["car", "drive"] },
      { char: "🚲", name: "bicycle", keywords: ["bike", "cycle"] },
      { char: "✈️", name: "airplane", keywords: ["plane", "travel"] },
      { char: "🏠", name: "house", keywords: ["home", "house"] },
      { char: "🧸", name: "teddy bear", keywords: ["teddy", "toy"] },
    ],
  },
];

export const ALL_EMOJIS: EmojiEntry[] = (() => {
  const seen = new Set<string>();
  const entries: EmojiEntry[] = [];

  for (const category of EMOJI_CATEGORIES) {
    category.emojis.forEach((emoji, index) => {
      if (seen.has(emoji.char)) {
        return;
      }

      seen.add(emoji.char);
      entries.push({
        id: `${category.id}-${index}`,
        char: emoji.char,
        name: emoji.name,
        keywords: emoji.keywords,
        categoryId: category.id,
        categoryLabel: category.label,
      });
    });
  }

  return entries;
})();

export function filterEmojis(query: string): EmojiEntry[] {
  const terms = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((term) => term.length > 0);

  if (terms.length === 0) {
    return ALL_EMOJIS;
  }

  return ALL_EMOJIS.filter((emoji) => {
    const haystack =
      `${emoji.name} ${emoji.keywords.join(" ")} ${emoji.categoryLabel}`.toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}

const EMOJI_GRAPHEME_PATTERN = /(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20E3)/u;
const MAX_JUMBO_EMOJI_GRAPHEMES = 3;

export function isEmojiOnlyMessage(text: string): boolean {
  const trimmed = text.trim();

  if (trimmed.length === 0) {
    return false;
  }

  const graphemes = splitChatGraphemes(trimmed);

  if (graphemes.length > MAX_JUMBO_EMOJI_GRAPHEMES) {
    return false;
  }

  return graphemes.every((grapheme) => EMOJI_GRAPHEME_PATTERN.test(grapheme));
}
