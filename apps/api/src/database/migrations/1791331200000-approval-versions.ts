import { MigrationInterface, QueryRunner } from 'typeorm';

export class ApprovalVersions1791331200000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      alter table approval_states add column item_version integer;
      update approval_states s set item_version=i.version from items i where i.id=s.item_id;
      alter table approval_states alter column item_version set default 1;
      alter table approval_states alter column item_version set not null;
      alter table approval_states add constraint approval_state_version_positive check (item_version > 0);
      alter table approval_decisions add column item_version integer;
      update approval_decisions d set item_version=i.version from items i where i.id=d.item_id;
      alter table approval_decisions alter column item_version set default 1;
      alter table approval_decisions alter column item_version set not null;
      alter table approval_decisions add constraint approval_decision_version_positive check (item_version > 0);
      alter table approval_decisions add column result_status text;
      alter table approval_decisions add column result_core_state core_state;
      update approval_decisions d set
        result_core_state=coalesce(s.core_state,case when d.status='approved' then 'approved'::core_state when d.status in ('rejected','swap_requested') then 'rejected'::core_state else 'pending'::core_state end),
        result_status=case when s.core_state='approved' then 'approved' when s.core_state='pending' then 'pending' when s.core_state='rejected' and d.status='swap_requested' then 'swap_requested' when s.core_state='rejected' then 'rejected' when d.status in ('approved','rejected','swap_requested') then d.status else 'pending' end
      from approval_states s where s.item_id=d.item_id;
      update approval_decisions d set result_core_state='pending',result_status='pending' where result_core_state is null;
      drop index approval_decisions_latest;
      create index approval_decisions_latest on approval_decisions (item_id, item_version, participant_id, decided_at desc, id desc);
    `);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`
      drop index approval_decisions_latest;
      create index approval_decisions_latest on approval_decisions (item_id, participant_id, decided_at desc);
      alter table approval_decisions drop column result_core_state;
      alter table approval_decisions drop column result_status;
      alter table approval_decisions drop constraint approval_decision_version_positive;
      alter table approval_decisions drop column item_version;
      alter table approval_states drop constraint approval_state_version_positive;
      alter table approval_states drop column item_version;
    `);
  }
}
