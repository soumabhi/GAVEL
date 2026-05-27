import { Devvit } from '@devvit/public-api';
import type { TriggerContext } from '@devvit/public-api';
import type { ModAction as ProtoModAction, AppInstall as ProtoAppInstall } from '@devvit/protos';
import { handleModAction } from './triggers.js';
import { registerMenuItems } from './menuItems.js';
import './forms.js';
import { settingsFields } from './config.js';

Devvit.configure({
  redditAPI: true,
  redis: true,
});

Devvit.addSettings(settingsFields);

registerMenuItems();

Devvit.addTrigger({
  event: 'ModAction',
  onEvent: async (event: ProtoModAction, context: TriggerContext) => {
    try {
      await handleModAction(event, context);
    } catch (err) {
      console.error('[Gavel] Unhandled error in ModAction trigger:', err);
    }
  },
});

Devvit.addTrigger({
  event: 'AppInstall',
  onEvent: async (_event: ProtoAppInstall, context: TriggerContext) => {
    console.log(`[Gavel] Installed in r/${context.subredditName} (${context.subredditId})`);
  },
});

export default Devvit;
