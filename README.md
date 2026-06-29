# Debate Analytics Platform

A full-stack analytics platform for competitive debating that centralizes tournament data, tracks long-term performance, and provides statistical insights across debates, motions, speaker roles, partnerships, and tournaments.

The platform automatically imports tournament data from **Tabbycat**, stores it in a normalized PostgreSQL database, and presents interactive analytics through a modern web interface.

---

## Features

### Tournament Management

* Import tournament data directly from Tabbycat
* Support for both **British Parliamentary (BP)** and **Asian Parliamentary (AP)** formats
* Automatic synchronization of rounds, motions, teams, speakers, and results
* Support for both tournament debates and practice mocks

### Motion Library

* Searchable repository of all debated motions
* Custom motion tagging system

  * Matter tags (Politics, IR, Economics, Criminal Justice, etc.)
  * Debate tags (Policy, Characterization, Counterfactual, Principles, etc.)
* Motion filtering by tournament, format, tags, performance, and date
* Case file management and post-round notes

### Round Analysis

* Complete round overview
* Speaker scores and team points
* Position-specific performance analysis
* Judge feedback and personal notes
* Flow sheet uploads
* Case file attachments
* Motion metadata and tournament statistics

### Analytics Dashboard

* Motion analytics
* Position analytics
* Side and bench bias analysis
* Draw strength and room quality analysis
* Partner statistics
* Opponent history
* Tournament performance tracking
* Longitudinal career trends
* Interactive charts and visualizations

### Career Tracking

* Tournament timeline
* Speaker score progression
* Win-rate analysis
* Performance breakdowns
* Searchable debate history

---

## Technology Stack

### Frontend

* React
* TypeScript
* Tailwind CSS

### Backend

* Node.js
* Express.js

### Database

* PostgreSQL
* Prisma ORM

### Data Ingestion

* Tabbycat REST API integration
* Authenticated HTML parsing
* ETL pipeline for tournament synchronization

---

## Architecture

```
Tabbycat
      │
      ▼
Import Pipeline
      │
      ▼
PostgreSQL
      │
      ▼
Analytics Engine
      │
      ▼
REST API
      │
      ▼
React Frontend
```

---

## Core Analytics

The platform computes statistical insights using SQL aggregation over historical debate data, including:

* Average, median and standard deviation of speaker scores
* Win rates across motion tags
* Government vs Opposition bias
* Opening vs Closing bias
* Speaker role benchmarking
* Draw strength and room quality
* Partner and opponent statistics
* Tournament trend analysis
* Career progression metrics

---

## Project Structure

```
client/
    React frontend

server/
    Express backend
    REST API
    Tabbycat ingestion

prisma/
    PostgreSQL schema

analytics/
    SQL analytics engine

uploads/
    Debate files
    Flows
    Case files
```

---

## Future Work

* Advanced analytics dashboards
* Custom report generation
* Tournament comparison
* Team-level analytics
* Export to PDF/CSV
* Public profile sharing

---

## License

This project is intended for educational and personal portfolio purposes.
