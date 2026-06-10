CREATE TABLE `email_verifications` (
	`id` int AUTO_INCREMENT NOT NULL,
	`email` varchar(320) NOT NULL,
	`code` varchar(10) NOT NULL,
	`expiresAt` timestamp NOT NULL,
	`used` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `email_verifications_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `scan_results` (
	`id` int AUTO_INCREMENT NOT NULL,
	`scanId` int NOT NULL,
	`aiScore` float,
	`aiDetailsJson` json,
	`plagiarismScore` float,
	`plagiarismDetailsJson` json,
	`citationsJson` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `scan_results_id` PRIMARY KEY(`id`),
	CONSTRAINT `scan_results_scanId_unique` UNIQUE(`scanId`)
);
--> statement-breakpoint
CREATE TABLE `scans` (
	`id` int AUTO_INCREMENT NOT NULL,
	`email` varchar(320) NOT NULL,
	`inputText` text NOT NULL,
	`fileName` varchar(255),
	`status` enum('pending','processing','completed','failed') NOT NULL DEFAULT 'pending',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `scans_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `verified_sessions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`sessionToken` varchar(128) NOT NULL,
	`email` varchar(320) NOT NULL,
	`expiresAt` timestamp NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `verified_sessions_id` PRIMARY KEY(`id`),
	CONSTRAINT `verified_sessions_sessionToken_unique` UNIQUE(`sessionToken`)
);
