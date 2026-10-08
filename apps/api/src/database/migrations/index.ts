import { InitialSchema1790985600000 } from './1790985600000-initial-schema';

import { AccountAuth1791072000000 } from './1791072000000-account-auth';

import { MediaDeliveryLeases1791158400000 } from './1791158400000-media-delivery-leases';
import { ClientAccess1791244800000 } from './1791244800000-client-access';
import { ApprovalVersions1791331200000 } from './1791331200000-approval-versions';

import { ItemTrash1791417600000 } from './1791417600000-item-trash';

export const migrations = [
  InitialSchema1790985600000,
  AccountAuth1791072000000,
  MediaDeliveryLeases1791158400000,
  ClientAccess1791244800000,
  ApprovalVersions1791331200000,
  ItemTrash1791417600000,
];
