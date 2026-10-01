CREATE TABLE `question_markers` (
	`inbox_id` text NOT NULL,
	`question_id` text NOT NULL,
	`fingerprint` text NOT NULL,
	PRIMARY KEY(`inbox_id`, `question_id`),
	FOREIGN KEY (`inbox_id`) REFERENCES `inboxes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO question_markers (inbox_id, question_id, fingerprint)
SELECT inbox_id, question_id, fingerprint FROM questions;
