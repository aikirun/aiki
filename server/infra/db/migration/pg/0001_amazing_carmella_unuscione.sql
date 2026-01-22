CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER trg_user_updated_at
  BEFORE UPDATE ON "user"
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();--> statement-breakpoint

CREATE TRIGGER trg_session_updated_at
  BEFORE UPDATE ON "session"
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();--> statement-breakpoint

CREATE TRIGGER trg_account_updated_at
  BEFORE UPDATE ON "account"
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();--> statement-breakpoint

CREATE TRIGGER trg_verification_updated_at
  BEFORE UPDATE ON "verification"
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();--> statement-breakpoint

CREATE TRIGGER trg_organization_updated_at
  BEFORE UPDATE ON "organization"
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();--> statement-breakpoint

CREATE TRIGGER trg_organization_invitation_updated_at
  BEFORE UPDATE ON "organization_invitation"
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();--> statement-breakpoint

CREATE TRIGGER trg_namespace_updated_at
  BEFORE UPDATE ON "namespace"
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();--> statement-breakpoint

CREATE TRIGGER trg_api_key_updated_at
  BEFORE UPDATE ON "api_key"
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();--> statement-breakpoint

CREATE TRIGGER trg_schedule_updated_at
  BEFORE UPDATE ON "schedule"
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();--> statement-breakpoint

CREATE TRIGGER trg_workflow_run_updated_at
  BEFORE UPDATE ON "workflow_run"
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();--> statement-breakpoint

CREATE TRIGGER trg_task_updated_at
  BEFORE UPDATE ON "task"
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
