ALTER TABLE "user_identifiers" ADD CONSTRAINT "chk_identifier_sensitive_encrypted" CHECK ("type" NOT IN ('AADHAAR', 'PAN') OR (
        "value_plain" IS NULL
        AND "value_encrypted" IS NOT NULL
        AND "value_hash" IS NOT NULL
        AND "value_masked" IS NOT NULL
      ));