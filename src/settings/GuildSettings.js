import Settings from './Settings.js';
import TypeChecker from './TypeChecker.js';
import {channelMention, Collection, EmbedBuilder, roleMention} from 'discord.js';
import Punishment, {PunishmentAction} from '../database/Punishment.js';
import Zendesk from '../apis/Zendesk.js';
import colors from '../util/colors.js';
import {formatTime, parseTime} from '../util/timeutils.js';
import YouTubePlaylist from '../apis/YouTubePlaylist.js';
import {inlineEmojiIfExists} from '../util/format.js';
import config from '../bot/Config.js';

/**
 * @typedef {Object} SafeSearchSettings
 * @property {boolean} enabled
 * @property {number} strikes
 */

/**
 * @classdesc settings of a guild
 */
export default class GuildSettings extends Settings {

    static tableName = 'guilds';

    #punishments = {
        1: Punishment.from(PunishmentAction.MUTE, '5 minutes'),
        2: Punishment.from(PunishmentAction.MUTE, '30 minutes'),
        3: Punishment.from(PunishmentAction.MUTE, '3 hours'),
        5: Punishment.from(PunishmentAction.BAN, '1 day'),
        6: Punishment.from(PunishmentAction.BAN, '1 week'),
        7: Punishment.from(PunishmentAction.BAN, '2 weeks'),
        8: Punishment.from(PunishmentAction.BAN, '2 months'),
        9: Punishment.from(PunishmentAction.BAN, '6 months'),
        11: Punishment.from(PunishmentAction.BAN),
    };

    #protectedRoles = [];

    /**
     * @param  {import('discord.js').Snowflake}   id                        guild id
     * @param  {Object}                           [json]                    options
     * @param  {import('discord.js').Snowflake}   [json.logChannel]         id of the log channel
     * @param  {import('discord.js').Snowflake}   [json.messageLogChannel]  id of the message log channel
     * @param  {import('discord.js').Snowflake}   [json.joinLogChannel]     id of the join log channel
     * @param  {import('discord.js').Snowflake}   [json.mutedRole]          id of the muted role
     * @param  {import('discord.js').Snowflake[]} [json.modRoles]           role ids that can execute commands
     * @param  {import('discord.js').Snowflake[]} [json.protectedRoles]     role ids that can't be targeted by moderations
     * @param  {Object}                           [json.punishments]        automatic punishments for strikes
     * @param  {String}                           [json.playlist]           id of YouTube playlist for tutorials
     * @param  {String}                           [json.helpcenter]         subdomain of the zendesk help center
     * @param  {Boolean}                          [json.invites]            allow invites (can be overwritten per channel)
     * @param  {Number}                           [json.linkCooldown]       cooldown on links in s (user based)
     * @param  {Number}                           [json.attachmentCooldown] cooldown on attachments in s (user based)
     * @param  {Boolean}                          [json.caps]               should caps be automatically deleted
     * @param  {Number}                           [json.antiSpam]           should message spam detection be enabled
     * @param  {Number}                           [json.similarMessages]    should similar message detection be enabled
     * @param  {?SafeSearchSettings}              [json.safeSearch]         safe search configuration
     * @return {GuildSettings}
     */
    constructor(id, json = {}) {
        super(id);

        this.logChannel = json.logChannel;
        this.messageLogChannel = json.messageLogChannel;
        this.joinLogChannel = json.joinLogChannel;

        this.mutedRole = json.mutedRole;
        if (json.protectedRoles instanceof Array)
            this.#protectedRoles = json.protectedRoles;
        if (json.modRoles instanceof Array)
            this.#protectedRoles.push(...json.modRoles);

        this.#punishments = json.punishments ?? this.#punishments;

        this.playlist = json.playlist;
        this.helpcenter = json.helpcenter;

        this.invites = json.invites ?? true;
        this.linkCooldown = json.linkCooldown ?? parseTime('10s');
        this.attachmentCooldown = json.attachmentCooldown ?? parseTime('10s');
        this.caps = json.caps ?? false;
        this.antiSpam = json.antiSpam ?? 10;
        this.similarMessages = json.similarMessages ?? 3;
        this.safeSearch = json.safeSearch ?? {enabled: true, strikes: 1};
    }

    /**
     * check if the types of this object are a valid guild settings
     * @param {Object} json
     * @throws {TypeError} incorrect types
     */
    static checkTypes(json) {
        TypeChecker.assertOfTypes(json, ['object'], 'Data object');

        TypeChecker.assertStringUndefinedOrNull(json.logChannel, 'Log channel');
        TypeChecker.assertStringUndefinedOrNull(json.messageLogChannel, 'Message log channel');
        TypeChecker.assertStringUndefinedOrNull(json.mutedRole, 'Muted role');

        if (!(json.protectedRoles instanceof Array) || !json.protectedRoles.every(r => typeof r === 'string')) {
            throw new TypeError('Protected roles must be an array of strings!');
        }

        if (!(json.punishments instanceof Object) ||
            !Object.values(json.punishments).every(punishment => ['ban','kick','mute','softban','strike'].includes(punishment.action))) {
            throw new TypeError('Invalid punishments');
        }

        TypeChecker.assertStringUndefinedOrNull(json.playlist, 'Playlist');
        TypeChecker.assertStringUndefinedOrNull(json.helpcenter, 'Help center');

        TypeChecker.assertOfTypes(json.invites, ['boolean', 'undefined'], 'Invites');
        TypeChecker.assertNumberUndefinedOrNull(json.linkCooldown, 'Link cooldown');
        TypeChecker.assertNumberUndefinedOrNull(json.attachmentCooldown, 'Attachment cooldown');
        TypeChecker.assertNumberUndefinedOrNull(json.antiSpam, 'Anti Spam');
        TypeChecker.assertNumberUndefinedOrNull(json.similarMessages, 'Similar Messages');
        TypeChecker.assertOfTypes(json.safeSearch, ['object', 'undefined'], 'Safe Search', true);
        if (typeof json.safeSearch === 'object') {
            if (typeof json.safeSearch.enabled !== 'boolean') {
                throw new TypeError('Invalid safe search configuration');
            }
            TypeChecker.assertNumberUndefinedOrNull(json.safeSearch.strikes, 'Safe Search');
        }
    }

    /**
     * @param {String} id
     * @return {Promise<GuildSettings>}
     */
    static async get(id) {
        return super.get(id);
    }

    /**
     * generate a settings embed
     * @returns {EmbedBuilder}
     */
    getSettings() {
        return new EmbedBuilder()
            .addFields(/** @type {*} */ [
                {name: 'Moderation', value: this.getModerationSettings(), inline: false},
                {name: 'Automod', value: this.getAutomodSettings(), inline: false},
                {name: 'Connections', value: this.getConnectionsSettings(), inline: false}
            ])
            .setColor(colors.GREEN);
    }

    /**
     * generate an overview of moderation settings
     * @returns {string}
     */
    getModerationSettings() {
        const protectedRoles = this.getProtectedRoles().map(role => '- ' + roleMention(role)).join('\n') || 'None';

        return `Log: ${this.logChannel ? channelMention(this.logChannel) : 'disabled'}\n` +
            `Message Log: ${this.messageLogChannel ? channelMention(this.messageLogChannel) : 'disabled'}\n` +
            `Join Log: ${this.joinLogChannel ? channelMention(this.joinLogChannel) : 'disabled'}\n` +
            `Muted role: ${this.mutedRole ? roleMention(this.mutedRole) : 'disabled'}\n` +
            `Protected roles: ${this.getProtectedRoles().length ? '\n' : ''}${protectedRoles}\n`;
    }

    /**
     * generate an overview of connection settings
     * @returns {string}
     */
    getConnectionsSettings() {
        //How can YouTube's link shortener *NOT* support playlists?
        return inlineEmojiIfExists('youtube') + `Playlist: ${this.playlist ? this.getPlaylist().getFormattedUrl() : 'disabled'}\n` +
            inlineEmojiIfExists('zendesk') + `Helpcenter: ${this.helpcenter ? `https://${this.helpcenter}.zendesk.com/` : 'disabled'}\n`;
    }

    /**
     * generate an overview of automod settings
     * @returns {String}
     */
    getAutomodSettings() {
        const lines = [
            `Invites: ${this.invites ? 'allowed' : 'forbidden'}`,
            `Link cooldown: ${this.linkCooldown !== -1 ? formatTime(this.linkCooldown) : 'disabled'}`,
            `Attachment cooldown: ${this.attachmentCooldown !== -1 ? formatTime(this.attachmentCooldown) : 'disabled'}`,
            `Caps: ${this.caps ? 'forbidden' : 'allowed'}`,
            `Spam protection: ${this.antiSpam === -1 ? 'disabled' : `${this.antiSpam} messages per minute`}`,
            `Repeated message protection: ${this.similarMessages === -1 ? 'disabled' : `${this.similarMessages} similar messages per minute`}`,
        ];

        if (this.isFeatureWhitelisted) {
            if (this.safeSearch.enabled) {
                lines.push(`Safe search: enabled (${this.safeSearch.strikes} strikes)`);
            }
            else {
                lines.push('Safe search: disabled');
            }
        }

        return lines.join('\n');
    }

    /**
     * is this guild in the feature whitelist
     * @return {boolean}
     */
    get isFeatureWhitelisted() {
        return config.data.featureWhitelist.includes(this.id);
    }

    /**
     * Is this a protected role?
     * @param  {import('discord.js').Snowflake} role role id
     * @return {Boolean}
     */
    isProtectedRole(role) {
        return this.#protectedRoles.includes(role);
    }

    /**
     * Is this member protected?
     * @async
     * @param {import('discord.js').GuildMember} member member object of the user in the specific guild
     * @return {Boolean}
     */
    isProtected(member) {
        for (let [key] of member.roles.cache) {
            if (this.isProtectedRole(key))
                return true;
        }
        return false;
    }

    /**
     * Add this role to the protected roles
     * @param  {import('discord.js').Snowflake} role role id
     */
    addProtectedRole(role) {
        if (!this.isProtectedRole(role)) {
            this.#protectedRoles.push(role);
        }
    }

    /**
     * Remove this role from the protected roles
     * @param  {import('discord.js').Snowflake} role role id
     */
    removeProtectedRole(role) {
        let newRoles = [];
        for (let protectedRole of this.#protectedRoles) {
            if (protectedRole !== role)
                newRoles.push(role);
        }
        this.#protectedRoles = newRoles;
    }

    /**
     * get all protected roles
     * @return {import('discord.js').Snowflake[]}
     */
    getProtectedRoles() {
        return this.#protectedRoles;
    }

    /**
     * get a specific punishment
     * @param {Number} strikes
     * @return {?Punishment}
     */
    getPunishment(strikes) {
        if (!this.#punishments[strikes]) {
            return null;
        }

        return new Punishment(this.#punishments[strikes]);
    }

    /**
     * find the last punishment
     * @param {Number} strikes
     * @return {Punishment}
     */
    findPunishment(strikes) {
        let punishment;
        do {
            punishment = this.getPunishment(strikes);
            strikes --;
        } while (!punishment && strikes > 0);
        return punishment;
    }

    /**
     * set a punishment
     * @param {Number} strikes
     * @param {?Punishment} punishment
     * @return {Promise<>}
     */
    setPunishment(strikes, punishment) {
        if (punishment === null)
            delete this.#punishments[strikes];
        else
            this.#punishments[strikes] = punishment;
        return this.save();
    }

    /**
     * get all punishments
     * @return {Collection<Number, Punishment>}
     */
    getPunishments() {
        const punishments = new Collection();

        for (const key of Object.keys(this.#punishments)) {
            punishments.set(parseInt(key), this.#punishments[key]);
        }

        return punishments;
    }

    /**
     * get the zendesk instance for this guild
     * @return {Zendesk}
     */
    getZendesk() {
        if (!this.helpcenter) {
            return null;
        }

        return new Zendesk(this.helpcenter);
    }

    /**
     * get the YouTube playlist for this guild
     * @return {YouTubePlaylist}
     */
    getPlaylist() {
        if (!this.playlist) {
            return null;
        }

        return new YouTubePlaylist(this.playlist);
    }

    getDataObject(o = this) {
        //copy to new object
        const cleanObject = {};
        Object.assign(cleanObject, o);

        //copy private properties
        cleanObject.punishments = this.#punishments;
        cleanObject.protectedRoles = this.#protectedRoles;

        return super.getDataObject(cleanObject);
    }
}
