import makeConfig from "../../lib/plugins/config.js"
import { Bot as GrammyBot, InputFile } from "grammy";
import { HttpsProxyAgent } from "https-proxy-agent";
import imageSize from "image-size";
import { fileTypeFromBuffer } from "file-type";

process.env.NTBA_FIX_350 = 1

logger.info(logger.yellow("- 正在加载 Telegram 适配器插件"))

const { config, configSave } = await makeConfig("Telegram", {
    tips: "",
    permission: "master",
    proxy: "",
    reverseProxy: "",
    token: [],
}, {
    tips: [
        "欢迎使用 trss-yunzai-telegram-plugin ! 作者：zhiyu1998",
        "参考：https://gitee.com/kyrzy0416/trss-yunzai-telegram-plugin",
    ],
})

/**
 * 构造 grammY 发送的文件类型
 * @param data {type: string, file: string, name: string}
 * @returns {Promise<{}>}
 */
async function constructFileType(data) {
    const file = { }
    // 构造 url 和 buffer
    if (Buffer.isBuffer(data.file)) {
        file.url = data.name || "Buffer"
        file.buffer = data.file
    } else {
        file.url = data.file.replace(/^base64:\/\/.*/, "base64://...")
        file.buffer = await Bot.Buffer(data.file);
    }
    if (Buffer.isBuffer(file.buffer)) {
        file.type = await fileTypeFromBuffer(file.buffer);
    }
    return file;
}

/**
 * 格式化发送信息
 * @param ctx
 * @param fileInfo
 * @returns {string}
 */
function formatSendMessage(ctx, fileInfo) {
    return `[${ ctx.id }] (${ fileInfo.url } ${ (fileInfo.buffer.length / 1024).toFixed(2) }KB)`;
}

const adapter = new class TelegramAdapter {
    constructor() {
        this.id = "Telegram"
        this.name = "TelegramBot"
        this.version = `grammy v1.28.0`
    }

    async sendMsg(ctx, msg, opts = {}) {
        if (!Array.isArray(msg)) {
            msg = [msg];
        }

        const msgs = [];
        const message_id = [];
        let textParts = [];

        const sendText = async () => {
            const text = textParts.join("");
            if (!text) return;
            Bot.makeLog("info", `发送文本：[${ctx.id}] ${text}`, ctx.self_id);
            try {
                // 返回发送消息的信息
                const sendMsgInfo = await ctx.bot.api.sendMessage(ctx.id, text, opts);
                // 如果发送成功
                if (sendMsgInfo) {
                    msgs.push(sendMsgInfo);
                    if (sendMsgInfo.message_id) message_id.push(sendMsgInfo.message_id);
                }
            } catch (error) {
                Bot.makeLog("error", `发送文本失败：[${ctx.id}] ${error.message}`, ctx.self_id);
            }
            textParts = [];
        };

        const sendMedia = async (file, sendFunc) => {
            try {
                const ret = await sendFunc(file);
                if (ret) {
                    msgs.push(ret);
                    if (ret.message_id) message_id.push(ret.message_id);
                }
            } catch (error) {
                Bot.makeLog("error", `发送媒体失败：[${ctx.id}] ${error.message}`, ctx.self_id);
            }
        };

        /**
         * 处理策略
         * @type {{button: ((function(*): Promise<*>)|*), image: ((function(*): Promise<void>)|*), node: ((function(*): Promise<void>)|*), default: ((function(*): Promise<void>)|*), file: ((function(*): Promise<void>)|*), at: ((function(*): Promise<void>)|*), record: ((function(*): Promise<void>)|*), text: ((function(*): Promise<void>)|*), video: ((function(*): Promise<void>)|*), reply: ((function(*): Promise<void>)|*)}}
         */
        const handlers = {
            "text": async (i) => {
                textParts.push(i.text);
            },
            "image": async (i) => {
                await sendText();
                const file = await constructFileType(i);
                // 如果无法识别文件类型就中断
                if (file.type === undefined) {
                    Bot.makeLog("error", "无法识别文件类型：" + file.url, ctx.self_id);
                    return;
                }

                Bot.makeLog("info", `发送图片：${formatSendMessage(ctx, file)}`, ctx.self_id);
                const size = imageSize(file.buffer);
                const sendFunc = size.height > 1280 || size.width > 1280
                    ? () => ctx.bot.api.sendDocument(ctx.id, new InputFile(file.buffer), opts)
                    : () => ctx.bot.api.sendPhoto(ctx.id, new InputFile(file.buffer), opts);
                await sendMedia(file, sendFunc);
            },
            "record": async (i) => {
                await sendText();
                const file = await constructFileType(i);
                // 如果无法识别文件类型就中断
                if (file.type === undefined) {
                    Bot.makeLog("error", "无法识别文件类型：" + file.url, ctx.self_id);
                    return;
                }

                Bot.makeLog("info", `发送音频：${formatSendMessage(ctx, file)}`, ctx.self_id);
                const audioFuncs = {
                    "mp3": () => ctx.bot.api.sendAudio(ctx.id, new InputFile(file.buffer), opts),
                    "m4a": () => ctx.bot.api.sendAudio(ctx.id, new InputFile(file.buffer), opts),
                    "opus": () => ctx.bot.api.sendVoice(ctx.id, new InputFile(file.buffer), opts),
                };
                const sendFunc = audioFuncs[file.type.ext] || (() => ctx.bot.api.sendDocument(ctx.id, new InputFile(file.buffer, file.name), opts));
                await sendMedia(file, sendFunc);
            },
            "video": async (i) => {
                await sendText();
                const file = await constructFileType(i);
                // 如果无法识别文件类型就中断
                if (file.type === undefined) {
                    Bot.makeLog("error", "无法识别文件类型：" + file.url, ctx.self_id);
                    return;
                }

                Bot.makeLog("info", `发送视频：${formatSendMessage(ctx, file)}`, ctx.self_id);
                await sendMedia(file, () => ctx.bot.api.sendVideo(ctx.id, new InputFile(file.buffer), opts));
            },
            "file": async (i) => {
                await sendText();
                const file = await constructFileType(i);
                // 如果无法识别文件类型就中断
                if (file.type === undefined) {
                    Bot.makeLog("error", "无法识别文件类型：" + file.url, ctx.self_id);
                    return;
                }

                Bot.makeLog("info", `发送文件：${formatSendMessage(ctx, file)}`, ctx.self_id);
                await sendMedia(file, () => ctx.bot.api.sendDocument(ctx.id, new InputFile(file.buffer, file.name), opts));
            },
            "reply": async (i) => {
                opts.reply_to_message_id = i.id;
            },
            "at": async (i) => {
                textParts.push(`@${(await ctx.bot.pickFriend(i.qq).getInfo()).username}`);
            },
            "node": async (i) => {
                for (const ret of await Bot.sendForwardMsg(msg => this.sendMsg(ctx, msg), i.data)) {
                    msgs.push(...ret.data);
                    message_id.push(...ret.message_id);
                }
            },
            "button": async (i) => {
                // Handle button logic if needed
            },
            "default": async (i) => {
                textParts.push(JSON.stringify(i));
            }
        };

        for (let i of msg) {
            if (typeof i !== "object") {
                i = { type: "text", text: i };
            }
            const handler = handlers[i.type] || handlers["default"];
            await handler(i);
        }

        await sendText();
        return { data: msgs, message_id };
    }


    async recallMsg(data, message_id, opts) {
        Bot.makeLog("info", `撤回消息：[${ data.id }] ${ message_id }`, data.self_id)
        if (!Array.isArray(message_id))
            message_id = [message_id]
        const msgs = []
        for (const i of message_id)
            msgs.push(await data.bot.deleteMessage(data.id, i, opts))
        return msgs
    }

    async getAvatarUrl(ctx) {
        try {
            // 获取机器人自身的信息
            const me = await ctx.bot.api.getMe();
            // 获取头像
            const photos = await ctx.bot.api.getUserProfilePhotos(me.id);
            // 制作成URL
            const fileId = photos.photos[0][0].file_id;
            const file = await ctx.bot.api.getFile(fileId);
            return `https://api.telegram.org/file/bot${ ctx.bot.token }/${ file.file_path }`;
        } catch (err) {
            logger.error(`获取头像错误：${ logger.red(err) }`)
            return false
        }
    }

    pickFriend(id, user_id) {
        if (typeof user_id !== "string")
            user_id = String(user_id)
        const i = {
            ...Bot[id].fl.get(user_id),
            self_id: id,
            bot: Bot[id],
            id: user_id.replace(/^tg_/, ""),
        }
        return {
            ...i,
            sendMsg: (msg, opts) => this.sendMsg(i, msg, opts),
            recallMsg: (message_id, opts) => this.recallMsg(i, message_id, opts),
            getInfo: () => i.bot.api.getChat(i.id),
            getAvatarUrl: () => this.getAvatarUrl(i),
        }
    }

    pickMember(id, group_id, user_id) {
        if (typeof group_id !== "string")
            group_id = String(group_id)
        if (typeof user_id !== "string")
            user_id = String(user_id)
        const i = {
            ...Bot[id].fl.get(user_id),
            self_id: id,
            bot: Bot[id],
            group_id: group_id.replace(/^tg_/, ""),
            user_id: user_id.replace(/^tg_/, ""),
        }
        return {
            ...this.pickFriend(id, user_id),
            ...i,
            getInfo: () => i.bot.api.getChatMember(i.group_id, i.user_id),
        }
    }

    pickGroup(id, group_id) {
        if (typeof group_id !== "string")
            group_id = String(group_id)
        const i = {
            ...Bot[id].gl.get(group_id),
            self_id: id,
            bot: Bot[id],
            id: group_id.replace(/^tg_/, ""),
        }
        return {
            ...i,
            sendMsg: (msg, opts) => this.sendMsg(i, msg, opts),
            recallMsg: (message_id, opts) => this.recallMsg(i, message_id, opts),
            getInfo: () => i.bot.api.getChat(i.id),
            getAvatarUrl: () => this.getAvatarUrl(i),
            pickMember: user_id => this.pickMember(id, i.id, user_id),
        }
    }

    /**
     * 制作适配器消息的内容（核心，需要把这个写好）
     * @param ctx 格莱美的上下文
     */
    makeMessage(ctx) {
        // 创建一个对象进行 bot 浅拷贝
        const data = {};

        data.bot = Bot[ctx.self_id];
        data.post_type = "message";
        data.user_id = `tg_${ ctx.from.id }`
        data.sender = {
            user_id: ctx.user_id,
            nickname: `${ ctx.from.first_name }-${ ctx.from.username }`,
        }
        data.bot.fl.set(ctx.user_id, { ...ctx.from, ...ctx.sender })
        data.message_type = ctx.chat.type === "supergroup" ? "group" : ctx.chat.type;
        data.message = [];
        data.raw_message = "";

        // 消息内容
        if (ctx.message.text) {
            data.message.push({ type: "text", text: ctx.message.text })
            data.raw_message += ctx.message.text
        }
        // 消息制作
        if (ctx.from.id === ctx.chat.id) {
            // 制作私发消息
            Bot.makeLog("info", `好友消息：[${ data.sender.nickname }(${ data.user_id })] ${ data.raw_message }`, data.self_id)
        } else {
            // 制作群消息
            const groupMessage = ctx.update.message;
            data.group_id = `tg_${ groupMessage.chat.id }`
            data.group_name = `${ groupMessage.chat.title }-${ groupMessage.chat.username }`
            data.bot.gl.set(groupMessage.chat.id, {
                ...groupMessage.chat,
                group_id: data.group_id,
                group_name: data.group_name,
            })
            // 制作完成，打印
            Bot.makeLog("info", `群消息：[${ data.group_name }(${ data.group_id }), ${ data.sender.nickname }(${ data.user_id })] ${ data.raw_message }`, data.self_id)
        }
        Bot.em(`${ data.post_type }.${ data.message_type }`, data);
    }

    async connect(token) {
        const agent = config.proxy ? new HttpsProxyAgent(config.proxy) : undefined;
        const grammyBot = new GrammyBot(token, {
            client: {
                baseFetchConfig: {
                    baseUrl: config.reverseProxy || 'https://api.telegram.org', // Default base URL
                    agent, // Proxy agent if defined
                },
            },
        });
        // 格莱美初始化
        await grammyBot.init();
        grammyBot.info = await grammyBot.botInfo;

        if (!grammyBot.info?.id) {
            throw new Error('Failed to retrieve bot info');
        }
        // TG 机器人 ID
        const id = `tg_${ grammyBot.info.id }`

        // 配置信息
        Bot[id] = grammyBot;
        Bot[id].adapter = this;
        Bot[id].uid = id;
        Bot[id].nickname = `${ Bot[id].info.first_name }-${ Bot[id].info.username }`
        Bot[id].version = {
            id: this.id,
            name: this.name,
            version: this.version,
        }
        Bot[id].stat = { start_time: Date.now() / 1000 }
        Bot[id].fl = new Map
        Bot[id].gl = new Map
        Bot[id].gml = new Map

        Bot[id].pickFriend = user_id => this.pickFriend(id, user_id)
        Bot[id].pickUser = Bot[id].pickFriend

        Bot[id].pickMember = (group_id, user_id) => this.pickMember(id, group_id, user_id)
        Bot[id].pickGroup = group_id => this.pickGroup(id, group_id)

        Bot[id].avatar = await Bot[id].pickFriend(id).getAvatarUrl()

        Bot[id].on("message", async (ctx) => {
            ctx.self_id = id;
            this.makeMessage(ctx)
        })

        Bot.makeLog("mark", `${ this.name }(${ this.id }) - [${ Bot[id].nickname }] - ${ this.version } 已连接`, id)
        Bot.em(`connect.${ id }`, { self_id: id })
        await grammyBot.start();
    }

    async load() {
        for (const token of config.token) {
            await this.connect(token);
        }
    }
}

Bot.adapter.push(adapter)

export class Telegram extends plugin {
    constructor() {
        super({
            name: "TelegramAdapter",
            dsc: "Telegram 适配器设置",
            event: "message",
            rule: [
                {
                    reg: "^#[Tt][Gg]账号$",
                    fnc: "List",
                    permission: config.permission,
                },
                {
                    reg: "^#[Tt][Gg]设置[0-9]+:.+$",
                    fnc: "Token",
                    permission: config.permission,
                },
                {
                    reg: "^#[Tt][Gg](代理|反代)",
                    fnc: "Proxy",
                    permission: config.permission,
                }
            ]
        })
    }

    List() {
        this.reply(`共${ config.token.length }个账号：\n${ config.token.join("\n") }`, true)
    }

    async Token() {
        const token = this.e.msg.replace(/^#[Tt][Gg]设置/, "").trim()
        if (config.token.includes(token)) {
            config.token = config.token.filter(item => item !== token)
            this.reply(`账号已删除，重启后生效，共${ config.token.length }个账号`, true)
        } else {
            if (await adapter.connect(token)) {
                config.token.push(token)
                this.reply(`账号已连接，共${ config.token.length }个账号`, true)
            } else {
                this.reply(`账号连接失败`, true)
                return false
            }
        }
        await configSave()
    }

    async Proxy() {
        const proxy = this.e.msg.replace(/^#[Tt][Gg](代理|反代)/, "").trim()
        if (this.e.msg.match("代理")) {
            config.proxy = proxy
            this.reply(`代理已${ proxy ? "设置" : "删除" }，重启后生效`, true)
        } else {
            config.reverseProxy = proxy
            this.reply(`反代已${ proxy ? "设置" : "删除" }，重启后生效`, true)
        }
        await configSave()
    }
}

logger.info(logger.green("- Telegram 适配器插件 加载完成"))