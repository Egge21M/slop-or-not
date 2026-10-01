CREATE TABLE `inboxes` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `questions` (
	`inbox_id` text NOT NULL,
	`question_id` text NOT NULL,
	`fingerprint` text NOT NULL,
	`wording` text NOT NULL,
	`project` text NOT NULL,
	`agent_session` text NOT NULL,
	`supporting_markdown` text,
	`created_at` integer NOT NULL,
	`prio` integer DEFAULT false NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	`response` text,
	`finished_at` integer,
	PRIMARY KEY(`inbox_id`, `question_id`),
	FOREIGN KEY (`inbox_id`) REFERENCES `inboxes`(`id`) ON UPDATE no action ON DELETE cascade
);
