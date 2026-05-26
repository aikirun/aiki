CREATE OR REPLACE FUNCTION iam_set_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER trg_user_updated_at
  BEFORE UPDATE ON "user"
  FOR EACH ROW
  EXECUTE FUNCTION iam_set_updated_at_column();--> statement-breakpoint

CREATE TRIGGER trg_session_updated_at
  BEFORE UPDATE ON "session"
  FOR EACH ROW
  EXECUTE FUNCTION iam_set_updated_at_column();--> statement-breakpoint

CREATE TRIGGER trg_account_updated_at
  BEFORE UPDATE ON "account"
  FOR EACH ROW
  EXECUTE FUNCTION iam_set_updated_at_column();--> statement-breakpoint

CREATE TRIGGER trg_verification_updated_at
  BEFORE UPDATE ON "verification"
  FOR EACH ROW
  EXECUTE FUNCTION iam_set_updated_at_column();--> statement-breakpoint

CREATE TRIGGER trg_organization_updated_at
  BEFORE UPDATE ON "organization"
  FOR EACH ROW
  EXECUTE FUNCTION iam_set_updated_at_column();--> statement-breakpoint

CREATE TRIGGER trg_organization_member_updated_at
  BEFORE UPDATE ON "organization_member"
  FOR EACH ROW
  EXECUTE FUNCTION iam_set_updated_at_column();--> statement-breakpoint

CREATE TRIGGER trg_organization_invitation_updated_at
  BEFORE UPDATE ON "organization_invitation"
  FOR EACH ROW
  EXECUTE FUNCTION iam_set_updated_at_column();--> statement-breakpoint

CREATE TRIGGER trg_namespace_updated_at
  BEFORE UPDATE ON "namespace"
  FOR EACH ROW
  EXECUTE FUNCTION iam_set_updated_at_column();--> statement-breakpoint

CREATE TRIGGER trg_namespace_member_updated_at
  BEFORE UPDATE ON "namespace_member"
  FOR EACH ROW
  EXECUTE FUNCTION iam_set_updated_at_column();--> statement-breakpoint

CREATE TRIGGER trg_api_key_updated_at
  BEFORE UPDATE ON "api_key"
  FOR EACH ROW
  EXECUTE FUNCTION iam_set_updated_at_column();--> statement-breakpoint