/**
 * Complaints & Dispute Resolution Service
 * Implements formal complaints procedure per MiCA requirements (15 business days response)
 */

import { pool } from '../../config/database';
import { v4 as uuidv4 } from 'uuid';

export interface Complaint {
  id: string;
  user_id: string;
  complaint_number: string;
  category: 'service_issue' | 'billing' | 'security' | 'privacy' | 'compliance' | 'other';
  subject: string;
  description: string;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  status: 'submitted' | 'acknowledged' | 'under_review' | 'resolved' | 'escalated' | 'closed';
  related_transaction_id?: string;
  related_task_id?: string;
  assigned_to?: string;
  submitted_at: Date;
  response_due_date: Date;
  first_response_at?: Date;
  resolved_at?: Date;
  resolution_notes?: string;
}

/**
 * Create complaint
 */
export async function createComplaint(
  userId: string,
  complaintData: {
    category: Complaint['category'];
    subject: string;
    description: string;
    related_transaction_id?: string;
    related_task_id?: string;
  }
): Promise<Complaint> {
  const complaintNumber = generateComplaintNumber();
  
  // Calculate response due date (15 business days per MiCA)
  const responseDueDate = calculateBusinessDays(new Date(), 15);
  
  const result = await pool.query(
    `INSERT INTO complaints
       (id, user_id, complaint_number, category, subject, description,
        related_transaction_id, related_task_id, priority, status,
        submitted_at, response_due_date, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CURRENT_TIMESTAMP, $11, CURRENT_TIMESTAMP)
     RETURNING *`,
    [
      uuidv4(),
      userId,
      complaintNumber,
      complaintData.category,
      complaintData.subject,
      complaintData.description,
      complaintData.related_transaction_id || null,
      complaintData.related_task_id || null,
      determinePriority(complaintData.category),
      'submitted',
      responseDueDate
    ]
  );
  
  return result.rows[0] as Complaint;
}

/**
 * Acknowledge complaint (within 24 hours)
 */
export async function acknowledgeComplaint(
  complaintId: string,
  acknowledgedBy: string
): Promise<void> {
  await pool.query(
    `UPDATE complaints
     SET status = 'acknowledged',
         acknowledged_at = CURRENT_TIMESTAMP,
         acknowledged_by = $1,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $2`,
    [acknowledgedBy, complaintId]
  );
}

/**
 * Assign complaint to staff member
 */
export async function assignComplaint(
  complaintId: string,
  assignedTo: string
): Promise<void> {
  await pool.query(
    `UPDATE complaints
     SET assigned_to = $1,
         status = 'under_review',
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $2`,
    [assignedTo, complaintId]
  );
}

/**
 * Resolve complaint
 */
export async function resolveComplaint(
  complaintId: string,
  resolutionNotes: string,
  satisfactory?: boolean
): Promise<void> {
  await pool.query(
    `UPDATE complaints
     SET status = 'resolved',
         resolution_notes = $1,
         resolution_satisfactory = $2,
         resolved_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $3`,
    [resolutionNotes, satisfactory, complaintId]
  );
}

/**
 * Escalate complaint to regulator
 */
export async function escalateToRegulator(
  complaintId: string,
  regulatorReference: string
): Promise<void> {
  await pool.query(
    `UPDATE complaints
     SET status = 'escalated',
         escalated_to_regulator = true,
         regulator_reference = $1,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $2`,
    [regulatorReference, complaintId]
  );
}

/**
 * Get user complaints
 */
export async function getUserComplaints(
  userId: string,
  status?: string
): Promise<Complaint[]> {
  let query = 'SELECT * FROM complaints WHERE user_id = $1';
  const params: any[] = [userId];
  
  if (status) {
    query += ' AND status = $2';
    params.push(status);
  }
  
  query += ' ORDER BY submitted_at DESC';
  
  const result = await pool.query(query, params);
  return result.rows as Complaint[];
}

/**
 * Get complaint by ID
 */
export async function getComplaint(complaintId: string): Promise<Complaint | null> {
  const result = await pool.query(
    'SELECT * FROM complaints WHERE id = $1',
    [complaintId]
  );
  
  if (result.rows.length === 0) {
    return null;
  }
  
  return result.rows[0] as Complaint;
}

/**
 * Get overdue complaints (past response due date)
 */
export async function getOverdueComplaints(): Promise<Complaint[]> {
  const result = await pool.query(
    `SELECT * FROM complaints
     WHERE response_due_date < CURRENT_DATE
       AND status NOT IN ('resolved', 'closed', 'escalated')
     ORDER BY response_due_date ASC`
  );
  
  return result.rows as Complaint[];
}

/**
 * Generate unique complaint number
 */
function generateComplaintNumber(): string {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `COMP-${timestamp}-${random}`;
}

/**
 * Calculate business days (excluding weekends)
 */
function calculateBusinessDays(startDate: Date, businessDays: number): Date {
  const date = new Date(startDate);
  let daysAdded = 0;
  
  while (daysAdded < businessDays) {
    date.setDate(date.getDate() + 1);
    // Skip weekends
    if (date.getDay() !== 0 && date.getDay() !== 6) {
      daysAdded++;
    }
  }
  
  return date;
}

/**
 * Determine priority based on category
 */
function determinePriority(category: Complaint['category']): 'low' | 'normal' | 'high' | 'urgent' {
  const priorityMap: Record<Complaint['category'], 'low' | 'normal' | 'high' | 'urgent'> = {
    'security': 'urgent',
    'privacy': 'high',
    'compliance': 'high',
    'billing': 'normal',
    'service_issue': 'normal',
    'other': 'low'
  };
  
  return priorityMap[category] || 'normal';
}

