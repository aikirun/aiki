CREATE OR REPLACE FUNCTION server_set_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER trg_schedule_updated_at
  BEFORE UPDATE ON "schedule"
  FOR EACH ROW
  EXECUTE FUNCTION server_set_updated_at_column();--> statement-breakpoint

CREATE TRIGGER trg_workflow_run_updated_at
  BEFORE UPDATE ON "workflow_run"
  FOR EACH ROW
  EXECUTE FUNCTION server_set_updated_at_column();--> statement-breakpoint

CREATE TRIGGER trg_task_updated_at
  BEFORE UPDATE ON "task"
  FOR EACH ROW
  EXECUTE FUNCTION server_set_updated_at_column();--> statement-breakpoint
  
CREATE TRIGGER trg_workflow_run_outbox_updated_at
  BEFORE UPDATE ON "workflow_run_outbox"
  FOR EACH ROW
  EXECUTE FUNCTION server_set_updated_at_column();--> statement-breakpoint