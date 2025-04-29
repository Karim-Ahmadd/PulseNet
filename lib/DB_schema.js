const db_schema= `
CREATE TABLE 'doctors' (
  'doctor_id' int NOT NULL AUTO_INCREMENT,
  'user_id' int NOT NULL,
  'first_name' varchar(50) NOT NULL,
  'last_name' varchar(50) NOT NULL,
  'gender' enum('Male','Female') DEFAULT NULL,
  'phone' varchar(20) DEFAULT NULL,
  'license_number' varchar(50) NOT NULL,
  'profile_picture' varchar(255) DEFAULT NULL,
  'bio' text,
  'qualifications' text,
  'experience_years' int DEFAULT NULL,
  'languages_spoken' varchar(255) DEFAULT NULL,
  'consultation_fee' decimal(10,2) DEFAULT NULL,
  'specialty_id' int NOT NULL,
  PRIMARY KEY ('doctor_id'),
  UNIQUE KEY 'user_id' ('user_id'),
  UNIQUE KEY 'license_number' ('license_number'),
  UNIQUE KEY 'user_id_2' ('user_id'),
  KEY 'doctors_ibfk_2' ('specialty_id'),
  CONSTRAINT 'doctors_ibfk_1' FOREIGN KEY ('user_id') REFERENCES 'users' ('user_id'),
  CONSTRAINT 'doctors_ibfk_2' FOREIGN KEY ('specialty_id') REFERENCES 'specialties' ('specialty_id') ON DELETE CASCADE
)
'doctors' table description: "Each row represents profile info of doctors"

CREATE TABLE 'clinics' (
  'clinic_id' int NOT NULL AUTO_INCREMENT,
  'name' varchar(100) NOT NULL,
  'address' varchar(255) NOT NULL,
  'phone' varchar(20) DEFAULT NULL,
  'email' varchar(100) DEFAULT NULL,
  'description' text,
  'logo' varchar(255) DEFAULT NULL,
  PRIMARY KEY ('clinic_id')
)
'clinics' table description: "Each row represents info about an available clinic"

CREATE TABLE 'doctor_calendar' (
  'schedule_id' int NOT NULL AUTO_INCREMENT,
  'doctor_id' int NOT NULL,
  'clinic_id' int NOT NULL,
  'day_of_week' enum('Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday') NOT NULL,
  'start_time' time NOT NULL,
  'end_time' time NOT NULL,
  'is_available' tinyint(1) NOT NULL DEFAULT '1',
  'notes' varchar(255) DEFAULT NULL,
  'date' date NOT NULL,
  PRIMARY KEY ('schedule_id'),
  UNIQUE KEY 'doctor_id' ('doctor_id','clinic_id','day_of_week'),
  KEY 'clinic_id' ('clinic_id'),
  CONSTRAINT 'doctor_calendar_ibfk_1' FOREIGN KEY ('doctor_id') REFERENCES 'users' ('user_id') ON DELETE CASCADE,
  CONSTRAINT 'doctor_calendar_ibfk_2' FOREIGN KEY ('clinic_id') REFERENCES 'clinics' ('clinic_id') ON DELETE CASCADE
)
'clinics' table description: "Each row represents info about a clinic"

CREATE TABLE 'clinic_calendar' (
  'schedule_id' int NOT NULL AUTO_INCREMENT,
  'clinic_id' int NOT NULL,
  'day_of_week' enum('Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday') NOT NULL,
  'is_open' tinyint(1) NOT NULL DEFAULT '1',
  'opening_time' time DEFAULT NULL,
  'closing_time' time DEFAULT NULL,
  'date' date NOT NULL,
  PRIMARY KEY ('schedule_id'),
  UNIQUE KEY 'clinic_id' ('clinic_id','day_of_week'),
  CONSTRAINT 'clinic_calendar_ibfk_1' FOREIGN KEY ('clinic_id') REFERENCES 'clinics' ('clinic_id') ON DELETE CASCADE
)
'clinic_calendar' table description: "Contains the schedule of the clinics. Each clinic has multiple rows in this table representing its schedule"


CREATE TABLE 'clinic_doctor' (
  'clinic_id' int NOT NULL,
  'doctor_id' int NOT NULL,
  PRIMARY KEY ('clinic_id','doctor_id'),
  KEY 'doctor_id' ('doctor_id'),
  CONSTRAINT 'clinic_doctor_ibfk_1' FOREIGN KEY ('clinic_id') REFERENCES 'clinics' ('clinic_id') ON DELETE CASCADE,
  CONSTRAINT 'clinic_doctor_ibfk_2' FOREIGN KEY ('doctor_id') REFERENCES 'users' ('user_id') ON DELETE CASCADE
)
'clinic_doctor' table description: "Each doctor can work in many clinic, and in each clinic many doctors work there"

CREATE TABLE 'appointment_slots' (
  'slot_id' int NOT NULL AUTO_INCREMENT,
  'doctor_id' int NOT NULL,
  'clinic_id' int NOT NULL,
  'slot_date' date NOT NULL,
  'start_time' time NOT NULL,
  'end_time' time NOT NULL,
  'is_booked' tinyint(1) NOT NULL DEFAULT '0',
  PRIMARY KEY ('slot_id'),
  UNIQUE KEY 'doctor_id' ('doctor_id','clinic_id','slot_date','start_time'),
  KEY 'clinic_id' ('clinic_id'),
  CONSTRAINT 'appointment_slots_ibfk_1' FOREIGN KEY ('doctor_id') REFERENCES 'users' ('user_id') ON DELETE CASCADE,
  CONSTRAINT 'appointment_slots_ibfk_2' FOREIGN KEY ('clinic_id') REFERENCES 'clinics' ('clinic_id') ON DELETE CASCADE
)
'appointment_slots' table description: "The available about slots for each doctor in a specific clinic. Only the unbooked (where is_booked=0) appointments should be shown"



`
export default db_schema;