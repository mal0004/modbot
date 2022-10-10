import SubCommandGroup from '../SubCommandGroup.js';
import AddAutoResponseCommand from './auto-response/AddAutoResponseCommand.js';
import ListAutoResponseCommand from './auto-response/ListAutoResponseCommand.js';
import ShowAutoReponseCommand from './auto-response/ShowAutoReponseCommand.js';
import DeleteAutoReponseCommand from './auto-response/DeleteAutoReponseCommand.js';
import EditAutoResponseCommand from './auto-response/EditAutoResponseCommand.js';

export default class AutoResponseCommandGroup extends SubCommandGroup {

    getChildren() {
        return [
            new ListAutoResponseCommand(),
            new AddAutoResponseCommand(),
            new ShowAutoReponseCommand(),
            new DeleteAutoReponseCommand(),
            new EditAutoResponseCommand(),
        ];
    }

    getDescription() {
        return 'Manage auto-responses';
    }

    getName() {
        return 'auto-response';
    }
}