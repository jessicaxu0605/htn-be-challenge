# HTN Backend Challenge

This repository contains my submission for the Hack the North backend challenge, implemented with a REST API. The implementation includes the specified endpoints, as well as some additional features I thought would be helpful for hackathon participants.

- **Users Endpoints**: Endpoints to retrieve information about a single user and all users, as specified in the challenge.
- **Skills Endpoints**: Endpoints to manage skills, including the option to set lower and upper bounds on frequency, as specified in the challenge.
- **Users Based On Skill Endpoint**: Additional endpoint to retrieve users with particular skills, facilitating the formation or joining of teams based on specific skills.
- **Hardware Checkout System**: Implements a hardware checkout system to manage hardware resources during the hackathon.

**Technologies Used:** Node/Express.js, MySql

## Setup Instructions:

- run **`npm install`** to install all required dependencies
- go to **`generate_db.js`** and change the connection credentials to a local MySQL user that has admin privileges (including create user and grant options)
  - ensure the user is identified with **mysql_native_password** authentication, as caching_sha2_password is not supported
- from root directory, run **`node generate_db.js`**. This will:
  - create a new database named `htn_be_db` on local MySQL server
  - create a user with CRUD access to the database
  - populate the new database with provided users, as well as custom data for hardware components to extend the application's function
  - generate a .env file to store connection credentials that will be used by the server
- run **`npm run server`** to start the API at `localhost:3600`

## Database Structure:

**users table**
Stores basic user information.
**primary key: `user_id`** - autoincremented surrogate key, just in case there are repeats in the other fields
**other fields:** `name` `company`, `email`, `phone`

---

**skills table**
Stores all of the skills that the current users have, along with the number of users who have that skill.
**primary key: `skill_name`** - natural key, since there is no possibility of duplicate skill names
**other fields:** `frequency`

---

**users_to_skills table**
One to many table that maps users to the skills they have
**primary key:** compound key of **`user_id` and `skill_name` as each entry must have a unique combination
**other fields:\*\* `rating`

- Note: since although some users in the original data have multiple entries of the same skill, even with the same rating, I decided to ignore duplicate values. This is the duplicate entry is practically meaningless--the user can only aquire the skill once, and if the ratings differ, there is no telling which rating is the accurate one.

---

**hardware table**
Stores all hardware components that are available for hackers to checkout, along with the quantity in stock
**primary key: `item_id`** - autoincremented surrogate key
**other fields:** `item_name`, `quantity_available`

---

**hardware_transactions table**
Records instances of users checking out and returning hardware components.
**primary key: `transaction_id`** - autoincremented surrogate key
**other fields:**
`user_id` - user who checked out the item
`item_name`
`checkout_date`
`return_date` - null if the user has not yet returned the item

## Endpoints

**`GET localhost:3600/users/`**
retrieves full data for all users in the database, including all skills that the user has

- return format is the same as the provided data for users

---

**`GET localhost:3600/users/:user_id`**
retrieves full data for the user specified by user_id

---

**`PUT localhost:3600/users/:user_id`**
updates data for the user specified by user_id
returns the full user data after the updates have been made

- partial updates are supported
- updates to skills are also supported
  - however, partial updates to skills are not supported. If a "skills" field is present in the request body, the skills for the user will be replaced entirely by the field.
- if skills are updated, both the users_to_skills table and the skills table are updatesd to reflect the change. If the user gained or lost skills, the frequency of skills in the skills table are updated, and possibly new entries are added

---

**`GET localhost:3600/skills/?min_frequency=xx&max_frequency=xx`**
retrieves all skills within the specified bounds, ordered from least to most frequent

- if no min_frequency is provided, only a upper bound is applied
- if no max_frequency is provided, only a lower bound is applied
- if neither min_frequency nor max_frequency are provided, all skills are returned

---

**`GET localhost:3600/users-by-skill/:skill`**
retrieves all users who have the specified skill, ordered by highest to lowest personal rating

- the skill parameter consists of the skill name, all in lowercase, with spaces replaced by hyphens "-" (eg. `django-rest-framework`)
  - Note: in future iterations, I would replace the primary key for skills with a surrogate key rather than using skill_name to identify skills; this would reduce the likelihood of mistakes in the URL parameter
- this endpoint may be useful to hackers looking to form/join a team with particular skills

---

**`GET localhost:3600/hardware/`**
retrieves all data for all entries in the hardware table

---

**`GET localhost:3600/hardware/:item_id`**
retrieves all data for the specified item in the hardware table

---

**`POST localhost:3600/hardware-checkout/`**
Initiates a new transaction for a specified user to checkout a specified hardware item. Checkout date is generated based on when the endpoint is hit.
Returns all data on the transaction.
request body fomat:

```
{ "user_id":  ,"item_id":  }
```

return format:

```
{
"transaction_id":  ,
"user_id":  ,
"item_id":  ,
"checkout_date":  ,
"return_date":
}
```

---

**`PUT localhost:3600/hardware-return/`**
Updates transaction to set the return date to the time the endpoint was hit
Returns all data on the transaction.
request body fomat:

```
{ "transaction_id": }
```

return format is same as hardware-checkout

---

**`GET localhost:3600/transaction-history/`**
Retrieves all transactions in the database, ordered by return date. Incomplete transactions (null return date) appear first.

---

**`GET localhost:3600/transaction-history/:user_id`**
Retrieves all transactions in the database by a specified user, ordered by return date. Incomplete transactions (null return date) appear first.
