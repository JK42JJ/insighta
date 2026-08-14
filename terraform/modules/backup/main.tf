# Where the nightly pg_dump and the Redis volume archive land.
#
# Versioning matters more than it looks: a backup job that starts writing empty
# files would otherwise overwrite good history with nothing, and versioning is
# what makes that recoverable. Public access is blocked at every one of the four
# switches rather than relying on bucket policy alone.
resource "aws_s3_bucket" "backups" {
  bucket = var.bucket_name
  tags   = var.tags
}

resource "aws_s3_bucket_versioning" "backups" {
  bucket = aws_s3_bucket.backups.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "backups" {
  bucket = aws_s3_bucket.backups.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "backups" {
  bucket                  = aws_s3_bucket.backups.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "backups" {
  bucket = aws_s3_bucket.backups.id

  # Objects move to infrequent access after a month and are deleted after three.
  # The backup workflows also prune at 30 days, so in practice the transition is
  # what this rule actually does; expiration is the backstop for anything the
  # workflows miss.
  rule {
    id     = "backup-lifecycle"
    status = "Enabled"

    filter {}

    transition {
      days          = var.transition_ia_days
      storage_class = "STANDARD_IA"
    }

    expiration {
      days = var.retention_days
    }
  }
}
