import {PermissionsBitField} from 'discord.js';

export default class ExecutableCommand {

    /**
     * @abstract
     * @return {string}
     */
    getName() {
        return 'unknown';
    }

    /**
     * @abstract
     * @return {string}
     */
    getDescription() {
        return 'unknown';
    }

    /**
     * get command cool down in seconds
     * @return {number}
     */
    getCoolDown() {
        return 0;
    }

    /**
     * required permissions. Null: no permissions required. Empty bitfield: disabled by default
     * @return {?import('discord.js').PermissionsBitField}
     */
    getRequiredUserPermissions() {
        return null;
    }

    /**
     * @return {import('discord.js').PermissionsBitField}
     */
    getRequiredBotPermissions() {
        return new PermissionsBitField();
    }

    buildOptions(builder) {
        return builder;
    }

    /**
     * @param {import('discord.js').BaseInteraction} interaction
     * @return {Promise<import('discord.js').ApplicationCommandOptionChoiceData[]>}
     */
    async complete(interaction) {
        return [];
    }

    /**
     * @abstract
     * @param {import('discord.js').BaseInteraction} interaction
     * @return {Promise<void>}
     */
    async execute(interaction) {

    }
}