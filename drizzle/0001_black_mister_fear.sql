-- Preserve existing reviews and notification links while removing identifying IDs.
CREATE TEMP TABLE assignment_id_recovery ON COMMIT DROP AS
SELECT company_id, id AS old_id, gen_random_uuid()::text AS new_id
FROM assignments
WHERE id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
--> statement-breakpoint
UPDATE notification_outbox AS notice
SET data = jsonb_set(jsonb_set(jsonb_set(notice.data, '{assignmentId}', to_jsonb(recovery.new_id)),
  '{href}', to_jsonb(replace(replace(notice.data->>'href', recovery.old_id, recovery.new_id),
    replace(recovery.old_id, ':', '%3A'), recovery.new_id))),
  '{key}', to_jsonb(CASE WHEN notice.data->>'kind' = 'reminder'
    THEN replace(notice.data->>'key', recovery.old_id, recovery.new_id)
    ELSE notice.data->>'key' END))
FROM assignment_id_recovery AS recovery
WHERE notice.company_id = recovery.company_id AND notice.data->>'assignmentId' = recovery.old_id;
--> statement-breakpoint
UPDATE assignments AS assignment
SET id = recovery.new_id, data = jsonb_set(assignment.data, '{id}', to_jsonb(recovery.new_id))
FROM assignment_id_recovery AS recovery
WHERE assignment.company_id = recovery.company_id AND assignment.id = recovery.old_id;
--> statement-breakpoint
CREATE UNIQUE INDEX "assignments_identity_unique" ON "assignments" USING btree ("company_id",("data"->>'cycleId'),("data"->>'type'),("data"->>'authorId'),("data"->>'subjectId'));--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_opaque_id" CHECK ("assignments"."id" ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' AND "assignments"."data"->>'id' = "assignments"."id");