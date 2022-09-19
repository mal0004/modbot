import Bot from '../bot/Bot.js';
import {
    ApplicationCommandPermissionType,
    ApplicationCommandType,
    PermissionFlagsBits, RESTJSONErrorCodes
} from 'discord.js';
import ArticleCommand from './utility/ArticleCommand.js';
import AvatarCommand from './utility/AvatarCommand.js';
import ExportCommand from './utility/ExportCommand.js';
import Cache from '../Cache.js';
import {formatTime} from '../util/timeutils.js';
import ImportCommand from './utility/ImportCommand.js';
import InfoCommand from './utility/InfoCommand.js';
import UserInfoCommand from './utility/UserInfoCommand.js';
import MemberWrapper from '../discord/MemberWrapper.js';
import BanCommand from './moderation/BanCommand.js';

const cooldowns = new Cache();

export default class CommandManager {
    static #instance;

    #commands = [
        new ArticleCommand(),
        new AvatarCommand(),
        new ExportCommand(),
        new ImportCommand(),
        new InfoCommand(),
        new UserInfoCommand(),

        new BanCommand(),
    ];

    static get instance() {
        return this.#instance ??= new CommandManager();
    }

    /**
     * @return {Command[]}
     */
    getCommands() {
        return this.#commands;
    }

    /**
     * register all slash commands
     * @return {Promise<void>}
     */
    async register() {
        /** @type {import('discord.js').ApplicationCommandDataResolvable[]} */
        const commands = [];
        for (const command of this.getCommands()) {
            commands.push(command.buildSlashCommand());
            if (command.supportsMessageCommands()) {
                commands.push(command.buildMessageCommand());
            }
            if (command.supportsUserCommands()) {
                commands.push(command.buildUserCommand());
            }
        }

        for (const [id, command] of await Bot.instance.client.application.commands.set(commands)) {
            if (command.type === ApplicationCommandType.ChatInput) {
                this.findCommand(command.name).id = id;
            }
        }
    }

    /**
     * find a command with this name
     * @param {string} name
     * @return {Command}
     */
    findCommand(name) {
        return this.getCommands().find(c => c.getName() === name.toLowerCase()) ?? null;
    }

    /**
     * check if this command can be executed in this context
     * @param {?Command} command
     * @param {import('discord.js').Interaction} interaction
     * @return {Promise<boolean>} is command executable
     */
    async checkCommandAvailability(command, interaction) {
        if (!command) {
            return false;
        }

        if (interaction.inGuild()) {
            const missingBotPermissions = interaction.appPermissions.missing(command.getRequiredBotPermissions());
            if (missingBotPermissions.length) {
                await interaction.reply({
                    content: `I'm missing the following permissions to execute this command: ${missingBotPermissions}`,
                    ephemeral:true
                });
                return false;
            }
        } else if (!command.isAvailableInDMs()) {
            return false;
        }

        if (command.getCoolDown()) {
            const key = `${interaction.user.id}:${command.getName()}`;
            const entry = cooldowns.getEntry(key);
            if (entry && !entry.isCacheTimeOver) {
                let remaining = entry.until - Date.now();
                remaining = Math.ceil(remaining / 1000);
                remaining = formatTime(remaining);

                await interaction.reply({
                    ephemeral: true,
                    content: `You can use this command again in ${remaining}`,
                });
                return false;
            }
            cooldowns.set(key, null, command.getCoolDown() * 1000);
        }
        return true;
    }

    /**
     * @param {import('discord.js').ChatInputCommandInteraction} interaction
     * @return {Promise<void>}
     */
    async execute(interaction) {
        const command = this.findCommand(interaction.commandName);
        if (!await this.checkCommandAvailability(command, interaction)) {
            return;
        }
        await command.execute(interaction);
    }

    /**
     * @param {import('discord.js').AutocompleteInteraction} interaction
     * @return {Promise<void>}
     */
    async autocomplete(interaction) {
        const command = this.findCommand(interaction.commandName);
        if (!command) {
            return;
        }

        await interaction.respond(await command.complete(interaction));
    }

    /**
     * @param {import('discord.js').UserContextMenuCommandInteraction} interaction
     * @return {Promise<void>}
     */
    async executeUserMenu(interaction) {
        const command = this.findCommand(interaction.commandName);
        if (!await this.checkCommandAvailability(command, interaction)) {
            return;
        }
        await command.executeUserMenu(interaction);
    }

    /**
     * @param {import('discord.js').MessageContextMenuCommandInteraction} interaction
     * @return {Promise<void>}
     */
    async executeMessageMenu(interaction) {
        const command = this.findCommand(interaction.commandName);
        if (!await this.checkCommandAvailability(command, interaction)) {
            return;
        }
        await command.executeMessageMenu(interaction);
    }

    /**
     * @param {import('discord.js').ButtonInteraction} interaction
     * @return {Promise<void>}
     */
    async executeButton(interaction) {
        if (!interaction.customId) {
            return;
        }
        const match = interaction.customId.match(/^([^:]+):/);
        if (!match || !match[1]) {
            return;
        }

        const command = this.findCommand(match[1]);
        if (!await this.checkCommandAvailability(command, interaction)) {
            return;
        }

        if (!command.isAvailableInDMs() && !await this.checkMemberPermissions(interaction, command)) {
            return;
        }

        await command.executeButton(interaction);
    }

    /**
     * @param {import('discord.js').ButtonInteraction} interaction
     * @param {Command} command
     * @return {Promise<boolean>}
     */
    async checkMemberPermissions(interaction, command) {
        const permission = await this.hasPermission(interaction, command);
        if (!permission) {
            await interaction.reply({content: 'You\'re not allowed to execute this command!', ephemeral: true});
        }
        return permission;
    }

    /**
     * @param {import('discord.js').ButtonInteraction} interaction
     * @param {Command} command
     * @return {Promise<boolean>}
     */
    async hasPermission(interaction, command) {
        const member = await (new MemberWrapper(interaction.user, interaction.guild)).fetchMember();

        if (!interaction.memberPermissions.has(PermissionFlagsBits.UseApplicationCommands)) {
            return false;
        }

        let overrides = null;
        try {
            overrides = await interaction.guild.commands.permissions.fetch({command: command.id});
        }
        catch (e) {
            if (e.code !== RESTJSONErrorCodes.UnknownApplicationCommandPermissions) {
                throw e;
            }
        }

        if (member.permissions.has(PermissionFlagsBits.Administrator)) {
            return true;
        }

        if (!overrides) {
            return command.getDefaultMemberPermissions() === null;
        }

        const everyOneOverride = overrides.find(override => override.type === ApplicationCommandPermissionType.Role
            && override.id === interaction.guild.roles.everyone.id);
        let permission = everyOneOverride.permission && command.getDefaultMemberPermissions() === null;
        const roleOverrides = overrides.filter(override => override.type === ApplicationCommandPermissionType.Role
            && member.roles.resolve(override.id));
        if (roleOverrides.some(override => override.permission === false)) {
            permission = false;
        }

        if (roleOverrides.some(override => override.permission === true)) {
            permission = true;
        }

        const memberOverride = overrides.find(override => override.type === ApplicationCommandPermissionType.User
            && override.id === interaction.user.id);
        if (memberOverride) {
            permission = memberOverride.permission;
        }
        return permission;
    }
}