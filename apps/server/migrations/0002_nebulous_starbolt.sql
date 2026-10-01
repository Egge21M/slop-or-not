CREATE TABLE `binary_choices` (
	`inbox_id` text NOT NULL,
	`question_id` text NOT NULL,
	`choice_id` text NOT NULL,
	PRIMARY KEY(`inbox_id`, `question_id`, `choice_id`),
	FOREIGN KEY (`inbox_id`) REFERENCES `inboxes`(`id`) ON UPDATE no action ON DELETE cascade
);
