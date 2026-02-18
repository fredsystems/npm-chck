import { emojify as nodeEmojify } from "node-emoji";

let emojiEnabled = true;

function emoji(name) {
    if (emojiEnabled) {
        return nodeEmojify(name);
    }

    return "";
}

function enabled(val) {
    emojiEnabled = val;
}

export default emoji;
export { enabled };
